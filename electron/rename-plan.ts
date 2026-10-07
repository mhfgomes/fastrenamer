import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { normalizePathKey } from '@fastrenamer/rename-engine';
import type { PlatformTarget, RenameBatchRecord } from '@fastrenamer/rename-engine';

/**
 * Identity of a filesystem entry captured right before it is renamed. `dev` + `ino` survive a
 * rename on the same volume, so they let undo/recovery tell "the file we renamed" apart from
 * "some other file that now lives at that path". When the platform reports no inode (`ino === '0'`)
 * we fall back to size + mtime for files.
 */
export interface FileFingerprint {
  dev: string;
  ino: string;
  size: string;
  mtimeNs: string;
  isDirectory: boolean;
}

export interface RecordedRenameItem extends RenameBatchRecord {
  fingerprint?: FileFingerprint | null;
}

export interface JournalEntry {
  sourcePath: string;
  targetPath: string;
  tempName: string;
  isDirectory: boolean;
  fingerprint: FileFingerprint;
}

export type JournalKind = 'execute' | 'undo' | 'recovery';
export type JournalStatus =
  | 'in_progress'
  | 'completed'
  | 'rolled_back'
  | 'rollback_failed'
  | 'recovered'
  | 'recovery_failed';

export interface RenameJournalWriter {
  beginJournal(kind: JournalKind, entries: JournalEntry[]): number;
  finishJournal(journalId: number, status: JournalStatus, message?: string): void;
}

export interface RenameFsOps {
  rename(from: string, to: string): Promise<void>;
  lstat(target: string): Promise<BigIntStats>;
}

export interface RenamePlanOptions {
  journal?: RenameJournalWriter;
  journalKind?: JournalKind;
  /** Keyed by normalizePathKey(sourcePath). Execution is refused if the item on disk differs. */
  expectedFingerprints?: Map<string, FileFingerprint | null | undefined>;
  fs?: Partial<RenameFsOps>;
}

export interface RenamePlanResult {
  /** Items with their final (parent-resolved) target paths and the fingerprint taken before renaming. */
  items: Array<RenameBatchRecord & { fingerprint: FileFingerprint }>;
  journalId: number | null;
}

/** The plan was rejected before anything on disk was touched. */
export class RenamePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RenamePlanError';
  }
}

/** A filesystem step failed mid-plan. `rolledBack` tells whether every completed step was reverted. */
export class RenameExecutionError extends Error {
  readonly rolledBack: boolean;
  readonly rollbackErrors: string[];

  constructor(message: string, rolledBack: boolean, rollbackErrors: string[]) {
    super(message);
    this.name = 'RenameExecutionError';
    this.rolledBack = rolledBack;
    this.rollbackErrors = rollbackErrors;
  }
}

export const MAX_NAME_LENGTH = 255;
export const TEMP_NAME_PREFIX = '.frtmp-';

const defaultFsOps: RenameFsOps = {
  rename: (from, to) => fsp.rename(from, to),
  lstat: (target) => fsp.lstat(target, { bigint: true }),
};

export function createTempName() {
  return `${TEMP_NAME_PREFIX}${crypto.randomBytes(6).toString('hex')}`;
}

export function fingerprintFromStats(stats: BigIntStats): FileFingerprint {
  return {
    dev: stats.dev.toString(),
    ino: stats.ino.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    isDirectory: stats.isDirectory(),
  };
}

export function fingerprintsMatch(expected: FileFingerprint, actual: FileFingerprint) {
  if (expected.ino !== '0' && actual.ino !== '0') {
    return expected.dev === actual.dev && expected.ino === actual.ino;
  }
  if (expected.isDirectory || actual.isDirectory) {
    return expected.isDirectory === actual.isDirectory;
  }
  return expected.size === actual.size && expected.mtimeNs === actual.mtimeNs;
}

function sameEntry(left: BigIntStats, right: BigIntStats) {
  return left.ino !== 0n && left.dev === right.dev && left.ino === right.ino;
}

function isErrorCode(error: unknown, code: string) {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === code;
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/** Returns a reason string when `name` cannot be used as a single path segment on `platform`. */
export function validateTargetName(name: string, platform: PlatformTarget): string | null {
  if (!name || name === '.' || name === '..') {
    return `"${name}" is not a valid name.`;
  }
  if (name.includes('/') || name.includes('\0') || (platform === 'win32' && name.includes('\\'))) {
    return `"${name}" contains a path separator or NUL character.`;
  }
  const length = platform === 'win32' ? name.length : Buffer.byteLength(name, 'utf8');
  if (length > MAX_NAME_LENGTH) {
    const unit = platform === 'win32' ? 'characters' : 'bytes';
    return `"${name}" is ${length} ${unit} long; the limit is ${MAX_NAME_LENGTH} ${unit}.`;
  }
  return null;
}

export interface HierarchyNode {
  /** Index of the nearest ancestor that is also part of the plan, or -1. */
  parentIndex: number;
  /** Path segments between that ancestor's source path and this item's parent directory. */
  segments: string[];
  depth: number;
}

/** Links every source path to its nearest ancestor that is also being renamed. */
export function buildHierarchy(platform: PlatformTarget, sourcePaths: string[]): HierarchyNode[] {
  const indexByKey = new Map<string, number>();
  sourcePaths.forEach((sourcePath, index) => indexByKey.set(normalizePathKey(sourcePath, platform), index));

  const nodes: HierarchyNode[] = sourcePaths.map((sourcePath) => {
    const segments: string[] = [];
    let current = path.dirname(sourcePath);
    while (true) {
      const parentIndex = indexByKey.get(normalizePathKey(current, platform));
      if (parentIndex !== undefined) {
        return { parentIndex, segments: segments.reverse(), depth: 0 };
      }
      const next = path.dirname(current);
      if (next === current) {
        return { parentIndex: -1, segments: [], depth: 0 };
      }
      segments.push(path.basename(current));
      current = next;
    }
  });

  const depthOf = (index: number): number => {
    const node = nodes[index];
    if (node.parentIndex === -1) {
      return 0;
    }
    if (node.depth === 0) {
      node.depth = depthOf(node.parentIndex) + 1;
    }
    return node.depth;
  };
  nodes.forEach((_node, index) => depthOf(index));
  return nodes;
}

interface PlannedRename {
  sourcePath: string;
  sourceName: string;
  targetName: string;
  finalPath: string;
  isDirectory: boolean;
  node: HierarchyNode;
}

/**
 * Normalizes and validates a rename plan without touching the disk. Each item's final path is
 * derived from its parent's final path when the parent is renamed in the same plan, so children
 * planned under a parent's old path still land in the right place.
 */
export function preparePlan(platform: PlatformTarget, items: RenameBatchRecord[]): PlannedRename[] {
  const resolved = items
    .map((item) => ({
      sourcePath: path.resolve(item.sourcePath),
      targetPath: path.resolve(item.targetPath),
      isDirectory: item.isDirectory,
    }))
    .filter(
      (item) =>
        !(
          path.dirname(item.sourcePath) === path.dirname(item.targetPath) &&
          path.basename(item.sourcePath) === path.basename(item.targetPath)
        ),
    );

  const sourceKeys = new Set<string>();
  for (const item of resolved) {
    if (path.dirname(item.sourcePath) === item.sourcePath) {
      throw new RenamePlanError(`Cannot rename a filesystem root: ${item.sourcePath}`);
    }
    const key = normalizePathKey(item.sourcePath, platform);
    if (sourceKeys.has(key)) {
      throw new RenamePlanError(`The plan renames the same item twice: ${item.sourcePath}`);
    }
    sourceKeys.add(key);
  }

  const nodes = buildHierarchy(
    platform,
    resolved.map((item) => item.sourcePath),
  );
  const finalPaths = new Array<string | undefined>(resolved.length);
  const finalDirOf = (index: number): string => {
    const node = nodes[index];
    if (node.parentIndex === -1) {
      return path.dirname(resolved[index].sourcePath);
    }
    return path.join(finalPathOf(node.parentIndex), ...node.segments);
  };
  const finalPathOf = (index: number): string => {
    const cached = finalPaths[index];
    if (cached) {
      return cached;
    }
    const finalPath = path.join(finalDirOf(index), path.basename(resolved[index].targetPath));
    finalPaths[index] = finalPath;
    return finalPath;
  };

  const finalKeys = new Map<string, string>();
  return resolved.map((item, index) => {
    const targetName = path.basename(item.targetPath);
    const finalDir = finalDirOf(index);
    const targetDirKey = normalizePathKey(path.dirname(item.targetPath), platform);
    if (
      targetDirKey !== normalizePathKey(finalDir, platform) &&
      targetDirKey !== normalizePathKey(path.dirname(item.sourcePath), platform)
    ) {
      throw new RenamePlanError(
        `Inconsistent plan: ${item.sourcePath} would move to ${item.targetPath}, outside its folder ${finalDir}.`,
      );
    }

    const nameIssue = validateTargetName(targetName, platform);
    if (nameIssue) {
      throw new RenamePlanError(`Cannot rename ${item.sourcePath}: ${nameIssue}`);
    }

    const finalPath = finalPathOf(index);
    const finalKey = normalizePathKey(finalPath, platform);
    const previousOwner = finalKeys.get(finalKey);
    if (previousOwner) {
      throw new RenamePlanError(
        `Inconsistent plan: ${previousOwner} and ${item.sourcePath} both resolve to ${finalPath}.`,
      );
    }
    finalKeys.set(finalKey, item.sourcePath);

    return {
      sourcePath: item.sourcePath,
      sourceName: path.basename(item.sourcePath),
      targetName,
      finalPath,
      isDirectory: item.isDirectory,
      node: nodes[index],
    };
  });
}

type ItemState = 'source' | 'temp' | 'target';

interface CompletedStep {
  from: string;
  to: string;
}

/**
 * Executes a batch rename in two stages (every item to a short unique temp name, then every temp
 * name to its final name) so swaps, cycles and case-only renames work. Every completed step is
 * recorded and reverted if a later step fails; a journal row is written before the first step so
 * an interrupted run can be recovered on the next start.
 */
export async function runRenamePlan(
  platform: PlatformTarget,
  items: RenameBatchRecord[],
  options: RenamePlanOptions = {},
): Promise<RenamePlanResult> {
  const fsOps: RenameFsOps = { ...defaultFsOps, ...options.fs };
  const plan = preparePlan(platform, items);
  if (plan.length === 0) {
    return { items: [], journalId: null };
  }

  const sourceKeys = new Set(plan.map((item) => normalizePathKey(item.sourcePath, platform)));

  // Preflight: everything must exist, match what was approved, and no target may be occupied by
  // something outside the plan. Nothing has been touched yet, so a failure here needs no rollback.
  const fingerprints: FileFingerprint[] = [];
  const planEntries = new Set<string>();
  for (const item of plan) {
    let stats: BigIntStats;
    try {
      stats = await fsOps.lstat(item.sourcePath);
    } catch (error) {
      throw new RenamePlanError(`Cannot read ${item.sourcePath}: ${describeError(error)}`);
    }
    const fingerprint = fingerprintFromStats(stats);
    const expected = options.expectedFingerprints?.get(normalizePathKey(item.sourcePath, platform));
    if (expected && !fingerprintsMatch(expected, fingerprint)) {
      throw new RenamePlanError(`${item.sourcePath} is no longer the item that was originally renamed.`);
    }
    fingerprints.push(fingerprint);
    if (fingerprint.ino !== '0') {
      planEntries.add(`${fingerprint.dev}:${fingerprint.ino}`);
    }
  }

  for (const item of plan) {
    const occupantPath = path.join(path.dirname(item.sourcePath), item.targetName);
    let occupant: BigIntStats;
    try {
      occupant = await fsOps.lstat(occupantPath);
    } catch (error) {
      if (isErrorCode(error, 'ENOENT')) {
        continue;
      }
      throw new RenamePlanError(`Cannot check target ${occupantPath}: ${describeError(error)}`);
    }
    const occupantIsInPlan =
      occupant.ino !== 0n
        ? planEntries.has(`${occupant.dev}:${occupant.ino}`)
        : sourceKeys.has(normalizePathKey(occupantPath, platform));
    if (!occupantIsInPlan) {
      throw new RenamePlanError(`Target already exists: ${occupantPath}`);
    }
  }

  const tempNames = plan.map(() => createTempName());
  const states: ItemState[] = plan.map(() => 'source');
  const currentPath = (index: number): string => {
    const item = plan[index];
    const { parentIndex, segments } = item.node;
    const baseDir =
      parentIndex === -1 ? path.dirname(item.sourcePath) : path.join(currentPath(parentIndex), ...segments);
    const name =
      states[index] === 'temp' ? tempNames[index] : states[index] === 'target' ? item.targetName : item.sourceName;
    return path.join(baseDir, name);
  };

  const journalKind = options.journalKind ?? 'execute';
  const journalId = options.journal
    ? options.journal.beginJournal(
        journalKind,
        plan.map((item, index) => ({
          sourcePath: item.sourcePath,
          targetPath: item.finalPath,
          tempName: tempNames[index],
          isDirectory: item.isDirectory,
          fingerprint: fingerprints[index],
        })),
      )
    : null;

  const completed: CompletedStep[] = [];
  const order = plan.map((_item, index) => index);
  const deepestFirst = [...order].sort((left, right) => plan[right].node.depth - plan[left].node.depth);
  const shallowestFirst = [...order].sort((left, right) => plan[left].node.depth - plan[right].node.depth);

  try {
    for (const index of deepestFirst) {
      const from = currentPath(index);
      states[index] = 'temp';
      const to = currentPath(index);
      states[index] = 'source';
      await assertVacant(fsOps, to, null);
      await fsOps.rename(from, to);
      states[index] = 'temp';
      completed.push({ from, to });
    }

    for (const index of shallowestFirst) {
      const from = currentPath(index);
      states[index] = 'target';
      const to = currentPath(index);
      states[index] = 'temp';
      await assertVacant(fsOps, to, from);
      await fsOps.rename(from, to);
      states[index] = 'target';
      completed.push({ from, to });
    }
  } catch (error) {
    const failure = describeError(error);
    const rollbackErrors = await rollback(fsOps, completed);
    const rolledBack = rollbackErrors.length === 0;
    if (journalId !== null) {
      try {
        options.journal?.finishJournal(
          journalId,
          rolledBack ? 'rolled_back' : 'rollback_failed',
          rolledBack ? failure : `${failure}\nRollback errors:\n${rollbackErrors.join('\n')}`,
        );
      } catch (journalError) {
        console.error('[rename-plan] Failed to update rename journal', journalError);
      }
    }
    throw new RenameExecutionError(
      rolledBack
        ? `${failure} All completed renames were reverted.`
        : `${failure} Some renames could not be reverted: ${rollbackErrors.join('; ')}`,
      rolledBack,
      rollbackErrors,
    );
  }

  if (journalId !== null) {
    try {
      options.journal?.finishJournal(journalId, 'completed');
    } catch (journalError) {
      // The renames succeeded. Startup recovery will see every item at its target and mark it done.
      console.error('[rename-plan] Failed to finalize rename journal', journalError);
    }
  }

  return {
    items: plan.map((item, index) => ({
      sourcePath: item.sourcePath,
      targetPath: item.finalPath,
      isDirectory: item.isDirectory,
      fingerprint: fingerprints[index],
    })),
    journalId,
  };
}

/**
 * Refuses to overwrite: `destination` must not exist, unless it is the very entry being moved
 * (a case-only rename on a case-insensitive volume).
 */
async function assertVacant(fsOps: RenameFsOps, destination: string, movingPath: string | null) {
  let existing: BigIntStats;
  try {
    existing = await fsOps.lstat(destination);
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return;
    }
    throw error;
  }
  if (movingPath) {
    const moving = await fsOps.lstat(movingPath);
    if (sameEntry(existing, moving)) {
      return;
    }
  }
  throw new Error(`Refusing to overwrite existing item: ${destination}`);
}

async function rollback(fsOps: RenameFsOps, completed: CompletedStep[]) {
  const errors: string[] = [];
  for (const step of [...completed].reverse()) {
    try {
      await assertVacant(fsOps, step.from, step.to);
      await fsOps.rename(step.to, step.from);
    } catch (error) {
      errors.push(`${step.to} -> ${step.from}: ${describeError(error)}`);
    }
  }
  return errors;
}
