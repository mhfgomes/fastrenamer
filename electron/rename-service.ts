import path from 'node:path';
import { promises as fsp } from 'node:fs';
import type { Dirent } from 'node:fs';
import { compareNatural, normalizePathKey } from '@fastrenamer/rename-engine';
import type {
  HistoryEntry,
  PlatformTarget,
  PreviewResult,
  RenameBatchRecord,
  RenameRule,
  ResolvedRenameItem,
  SortMode,
  SourceMode,
  SourceSelection,
} from '@fastrenamer/rename-engine';
import type {
  AppDirectoryListing,
  AppExecuteRenameBatchResult,
  AppPreviewResult,
  AppUndoRenameBatchResult,
} from '../src/shared/contracts';
import { computePlanId, planPreview } from './preview-planner';
import type { PlanPreviewInput } from './preview-planner';
import {
  RenameExecutionError,
  fingerprintFromStats,
  fingerprintsMatch,
  runRenamePlan,
} from './rename-plan';
import type { FileFingerprint, RecordedRenameItem, RenameJournalWriter } from './rename-plan';

/** Preview/execute input as used inside main: platform is always the host platform. */
export interface ServicePreviewRequest {
  sourcePaths: string[];
  sourceMode: SourceMode;
  fileNamePattern: string;
  sortMode: SortMode;
  rules: RenameRule[];
  platform: PlatformTarget;
  includeHidden?: boolean;
}

export interface ServiceExecuteRequest extends ServicePreviewRequest {
  planId: string;
}

/** Runs the CPU-bound planning step. Main passes a worker-backed planner; tests use the in-process default. */
export type PreviewPlanner = (input: PlanPreviewInput, signal?: AbortSignal) => Promise<PreviewResult>;

export const inProcessPlanner: PreviewPlanner = async (input) => planPreview(input);

export interface PreviewOptions {
  planner?: PreviewPlanner;
  signal?: AbortSignal;
}

interface RenameExecutionStore extends RenameJournalWriter {
  recordRenameBatch(input: {
    sourceRoots: string[];
    rules: RenameRule[];
    previewSummary: PreviewResult['summary'];
    renamedCount: number;
    items: RecordedRenameItem[];
  }): number;
}

interface RenameUndoStore {
  getBatch(batchId: number): HistoryEntry | undefined;
  getBatchItems(batchId: number): RecordedRenameItem[];
  getUndoReadyBatchItems(excludeBatchId?: number): Array<RenameBatchRecord & { batchId: number }>;
  markBatchUndone(batchId: number): void;
}

interface HistoryStore extends RenameUndoStore {
  listHistory(): HistoryEntry[];
}

interface UndoPreflightIssue {
  code: 'missing' | 'replaced' | 'occupied' | 'overlap';
  message: string;
}

// ---------------------------------------------------------------------------------------------
// Main-side lock: only one execute/undo may touch the filesystem at a time.

export class OperationBusyError extends Error {
  constructor(running: string) {
    super(`Another ${running} is still running. Wait for it to finish and try again.`);
    this.name = 'OperationBusyError';
  }
}

let runningOperation: string | null = null;

export async function withFileOperationLock<T>(label: string, task: () => Promise<T>): Promise<T> {
  if (runningOperation) {
    throw new OperationBusyError(runningOperation);
  }
  runningOperation = label;
  try {
    return await task();
  } finally {
    runningOperation = null;
  }
}

// ---------------------------------------------------------------------------------------------
// Directory scanning

export const DIRECTORY_COUNT_LIMIT = 10_000;

function isHiddenName(name: string) {
  return name.startsWith('.');
}

export async function pickableSource(pathname: string): Promise<SourceSelection> {
  const stats = await fsp.stat(pathname);
  return {
    path: pathname,
    name: path.basename(pathname),
    parentPath: path.dirname(pathname),
    isDirectory: stats.isDirectory(),
  };
}

export async function loadDirectoryListing(
  sourcePath: string,
  options: { includeHidden?: boolean; countLimit?: number } = {},
): Promise<AppDirectoryListing> {
  const includeHidden = options.includeHidden ?? false;
  const countLimit = options.countLimit ?? DIRECTORY_COUNT_LIMIT;
  let skippedDirectories = 0;

  const readVisible = async (directory: string): Promise<Dirent[] | null> => {
    try {
      const entries = await fsp.readdir(directory, { withFileTypes: true });
      return includeHidden ? entries : entries.filter((entry) => !isHiddenName(entry.name));
    } catch {
      skippedDirectories += 1;
      return null;
    }
  };

  const directEntries = (await readVisible(sourcePath)) ?? [];
  const items: SourceSelection[] = directEntries
    .map((entry) => ({
      path: path.join(sourcePath, entry.name),
      name: entry.name,
      parentPath: sourcePath,
      isDirectory: entry.isDirectory(),
    }))
    .sort((left, right) => compareNatural(left.path, right.path));

  // Count descendants, but stop at `countLimit`: the number is only informational and walking a
  // whole home directory just to display it is not worth it.
  let recursiveChildren = items.length;
  let truncated = recursiveChildren >= countLimit;
  const stack = items.filter((item) => item.isDirectory).map((item) => item.path);
  while (stack.length > 0 && !truncated) {
    const current = stack.pop() as string;
    const nestedEntries = await readVisible(current);
    if (!nestedEntries) {
      continue;
    }
    recursiveChildren += nestedEntries.length;
    if (recursiveChildren >= countLimit) {
      recursiveChildren = countLimit;
      truncated = true;
      break;
    }
    for (const entry of nestedEntries) {
      if (entry.isDirectory()) {
        stack.push(path.join(current, entry.name));
      }
    }
  }

  return {
    sourcePath,
    directChildren: items.length,
    recursiveChildren,
    items: items.slice(0, 10),
    skippedDirectories,
    recursiveChildrenTruncated: truncated,
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new PreviewSupersededError();
  }
}

export class PreviewSupersededError extends Error {
  constructor() {
    super('Preview was superseded by a newer request.');
    this.name = 'PreviewSupersededError';
  }
}

/**
 * Collects the candidate items for a request. Unreadable folders are skipped and counted instead
 * of failing the whole preview; hidden entries are skipped in folder-walking modes unless
 * `includeHidden` is set. File-name pattern filtering and sorting happen in the planner.
 */
export async function resolveSourceItems(request: ServicePreviewRequest, signal?: AbortSignal) {
  const seen = new Set<string>();
  const items: ResolvedRenameItem[] = [];
  const includeHidden = request.includeHidden ?? false;
  let skippedDirectories = 0;

  const addItem = (itemPath: string, isDirectory: boolean) => {
    const key = normalizePathKey(itemPath, request.platform);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({
      sourcePath: itemPath,
      name: path.basename(itemPath),
      parentPath: path.dirname(itemPath),
      isDirectory,
    });
  };

  const walkMode = async (directoryPath: string, mode: SourceMode, depth = 1): Promise<void> => {
    throwIfAborted(signal);
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    } catch {
      skippedDirectories += 1;
      return;
    }
    const orderedEntries = entries
      .filter((entry) => includeHidden || !isHiddenName(entry.name))
      .sort((left, right) => compareNatural(left.name, right.name));
    for (const entry of orderedEntries) {
      const childPath = path.join(directoryPath, entry.name);
      switch (mode) {
        case 'top_level_folders':
          if (depth === 1 && entry.isDirectory()) {
            addItem(childPath, true);
          }
          break;
        case 'subfolders':
          if (entry.isDirectory()) {
            if (depth >= 2) {
              addItem(childPath, true);
            }
            await walkMode(childPath, mode, depth + 1);
          }
          break;
        case 'top_level_files':
          if (depth === 1 && entry.isFile()) {
            addItem(childPath, false);
          }
          break;
        case 'files_recursive':
          if (entry.isFile()) {
            addItem(childPath, false);
          } else if (entry.isDirectory()) {
            await walkMode(childPath, mode, depth + 1);
          }
          break;
        case 'picked_folders':
        case 'picked_files':
          break;
      }
    }
  };

  for (const sourcePath of [...request.sourcePaths].sort(compareNatural)) {
    throwIfAborted(signal);
    const stats = await fsp.stat(sourcePath);
    if (request.sourceMode === 'picked_folders') {
      if (stats.isDirectory()) {
        addItem(sourcePath, true);
      }
      continue;
    }

    if (request.sourceMode === 'picked_files') {
      if (!stats.isDirectory()) {
        addItem(sourcePath, false);
      }
      continue;
    }

    if (stats.isDirectory()) {
      await walkMode(sourcePath, request.sourceMode);
    }
  }

  return { items, skippedDirectories };
}

export async function generatePreviewForRequest(
  request: ServicePreviewRequest,
  options: PreviewOptions = {},
): Promise<AppPreviewResult> {
  const { items, skippedDirectories } = await resolveSourceItems(request, options.signal);
  throwIfAborted(options.signal);
  const planner = options.planner ?? inProcessPlanner;
  const preview = await planner(
    {
      items,
      rules: request.rules,
      platform: request.platform,
      sortMode: request.sortMode,
      fileNamePattern: request.fileNamePattern,
    },
    options.signal,
  );
  return { ...preview, planId: computePlanId(preview), skippedDirectories };
}

/**
 * Keeps only the newest preview alive: starting a preview aborts the previous one (its directory
 * walk stops and its worker is terminated) and the stale call rejects with PreviewSupersededError.
 */
export function createLatestPreviewRunner(planner: PreviewPlanner) {
  let current: AbortController | null = null;
  return async (request: ServicePreviewRequest) => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    try {
      return await generatePreviewForRequest(request, { planner, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new PreviewSupersededError();
      }
      throw error;
    } finally {
      if (current === controller) {
        current = null;
      }
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Execute

export const PLAN_CHANGED_MESSAGE =
  'The files or rename rules changed since this preview was generated, so nothing was renamed. ' +
  'Review the refreshed preview and run the rename again.';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function executeRenameBatch(
  request: ServiceExecuteRequest,
  database: RenameExecutionStore,
  options: PreviewOptions = {},
): Promise<AppExecuteRenameBatchResult> {
  return withFileOperationLock('rename', async () => {
    // Regenerate and compare with what the user approved; never run a plan they did not see.
    const preview = await generatePreviewForRequest(request, options);
    const base = {
      ...preview,
      batchId: null,
      renamedCount: 0,
      warnings: [] as string[],
      historyRecorded: false,
      planChanged: false,
    };

    if (preview.planId !== request.planId) {
      return { ...base, blocked: true, planChanged: true, errors: [PLAN_CHANGED_MESSAGE] };
    }

    if (preview.summary.blocked) {
      return {
        ...base,
        blocked: true,
        errors: ['Execution blocked because the preview contains conflicts or invalid names.'],
      };
    }

    const operations: RenameBatchRecord[] = preview.rows
      .filter((row) => row.changed)
      .map((row) => ({
        sourcePath: row.sourcePath,
        targetPath: row.nextPath,
        isDirectory: row.isDirectory,
      }));

    let renamed: RecordedRenameItem[];
    try {
      const result = await runRenamePlan(request.platform, operations, {
        journal: database,
        journalKind: 'execute',
      });
      renamed = result.items;
    } catch (error) {
      const message = errorMessage(error, 'Unknown filesystem error');
      return {
        ...base,
        blocked: true,
        errors: [
          error instanceof RenameExecutionError
            ? `Rename execution failed: ${message}`
            : `Rename was not started: ${message}`,
        ],
      };
    }

    // The files are renamed at this point: a history failure must not be reported as a rename failure.
    let batchId: number | null = null;
    const warnings: string[] = [];
    try {
      batchId = database.recordRenameBatch({
        sourceRoots: [...request.sourcePaths],
        rules: request.rules,
        previewSummary: preview.summary,
        renamedCount: renamed.length,
        items: renamed,
      });
    } catch (error) {
      console.error('[rename-service] Renamed files but failed to record history', error);
      warnings.push(
        `${renamed.length} item(s) were renamed, but the rename could not be saved to history ` +
          `(${errorMessage(error, 'unknown database error')}). It cannot be undone from the app.`,
      );
    }

    return {
      ...base,
      batchId,
      renamedCount: renamed.length,
      blocked: false,
      errors: [],
      warnings,
      historyRecorded: batchId !== null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Undo

async function lstatFingerprint(target: string): Promise<FileFingerprint | null> {
  try {
    return fingerprintFromStats(await fsp.lstat(target, { bigint: true }));
  } catch {
    return null;
  }
}

async function buildUndoPreflightIssues(
  batchId: number,
  platform: PlatformTarget,
  batchItems: RecordedRenameItem[],
  otherUndoableItems: Array<RenameBatchRecord & { batchId: number }>,
) {
  const issues: UndoPreflightIssue[] = [];
  const currentKeys = new Set(batchItems.map((item) => normalizePathKey(item.targetPath, platform)));
  const overlappingBatchIds = new Set<number>();
  const otherPathOwners = new Map<string, Set<number>>();

  for (const item of otherUndoableItems.filter((candidate) => candidate.batchId > batchId)) {
    for (const key of [normalizePathKey(item.sourcePath, platform), normalizePathKey(item.targetPath, platform)]) {
      if (!otherPathOwners.has(key)) {
        otherPathOwners.set(key, new Set());
      }
      otherPathOwners.get(key)?.add(item.batchId);
    }
  }

  for (const item of batchItems) {
    const current = await lstatFingerprint(item.targetPath);
    if (!current) {
      issues.push({ code: 'missing', message: `Files not found at current renamed path: ${item.targetPath}` });
    } else if (item.fingerprint && !fingerprintsMatch(item.fingerprint, current)) {
      issues.push({
        code: 'replaced',
        message: `The item at ${item.targetPath} is not the one that was renamed (it was replaced).`,
      });
    }

    const restoreKey = normalizePathKey(item.sourcePath, platform);
    if (!currentKeys.has(restoreKey) && (await lstatFingerprint(item.sourcePath))) {
      issues.push({ code: 'occupied', message: `Restore target is occupied: ${item.sourcePath}` });
    }

    otherPathOwners
      .get(normalizePathKey(item.targetPath, platform))
      ?.forEach((ownerBatchId) => overlappingBatchIds.add(ownerBatchId));
    otherPathOwners.get(restoreKey)?.forEach((ownerBatchId) => overlappingBatchIds.add(ownerBatchId));
  }

  if (overlappingBatchIds.size > 0) {
    const batchList = [...overlappingBatchIds].sort((left, right) => right - left).join(', ');
    issues.push({
      code: 'overlap',
      message: `Overlaps with newer undo-ready batches: ${batchList}. Undo those first.`,
    });
  }

  return issues.filter(
    (issue, index, all) =>
      index === all.findIndex((candidate) => candidate.code === issue.code && candidate.message === issue.message),
  );
}

async function getUndoAvailability(
  entry: HistoryEntry,
  platform: PlatformTarget,
  database: RenameUndoStore,
): Promise<Pick<HistoryEntry, 'canUndo' | 'undoState' | 'undoReason'>> {
  if (entry.undoState === 'archived') {
    return { canUndo: false, undoState: 'archived', undoReason: entry.undoReason ?? 'This batch was already undone.' };
  }

  const issues = await buildUndoPreflightIssues(
    entry.id,
    platform,
    database.getBatchItems(entry.id),
    database.getUndoReadyBatchItems(entry.id),
  );

  const pick = (...codes: UndoPreflightIssue['code'][]) => issues.find((issue) => codes.includes(issue.code));
  const overlap = pick('overlap');
  if (overlap) {
    return { canUndo: false, undoState: 'overlap', undoReason: overlap.message };
  }
  const occupied = pick('occupied');
  if (occupied) {
    return { canUndo: false, undoState: 'occupied', undoReason: occupied.message };
  }
  const missing = pick('missing', 'replaced');
  if (missing) {
    return { canUndo: false, undoState: 'missing', undoReason: missing.message };
  }
  return { canUndo: true, undoState: 'ready', undoReason: undefined };
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export const HISTORY_STATUS_CONCURRENCY = 4;

export async function listHistoryWithUndoStatus(
  platform: PlatformTarget,
  database: HistoryStore,
): Promise<HistoryEntry[]> {
  return mapWithConcurrency(database.listHistory(), HISTORY_STATUS_CONCURRENCY, async (entry) => ({
    ...entry,
    ...(await getUndoAvailability(entry, platform, database)),
  }));
}

export async function undoRenameBatch(
  batchId: number,
  platform: PlatformTarget,
  database: RenameUndoStore,
  journal?: RenameJournalWriter,
): Promise<AppUndoRenameBatchResult> {
  return withFileOperationLock('undo', async () => {
    const failure = (message: string): AppUndoRenameBatchResult => ({
      batchId,
      restoredCount: 0,
      success: false,
      errors: [message],
      warnings: [],
    });

    const historyEntry = database.getBatch(batchId);
    const batchItems = database.getBatchItems(batchId);
    if (!historyEntry || batchItems.length === 0) {
      return failure(`Batch #${batchId} does not exist or has no recorded items.`);
    }

    const availability = await getUndoAvailability(historyEntry, platform, database);
    if (!availability.canUndo) {
      return failure(availability.undoReason ?? 'Undo is not available for this batch.');
    }

    const reversedItems = batchItems.map((item) => ({
      sourcePath: item.targetPath,
      targetPath: item.sourcePath,
      isDirectory: item.isDirectory,
    }));
    const expectedFingerprints = new Map(
      batchItems.map((item) => [normalizePathKey(item.targetPath, platform), item.fingerprint]),
    );

    try {
      await runRenamePlan(platform, reversedItems, { journal, journalKind: 'undo', expectedFingerprints });
    } catch (error) {
      return failure(errorMessage(error, 'Undo failed.'));
    }

    const warnings: string[] = [];
    try {
      database.markBatchUndone(batchId);
    } catch (error) {
      console.error('[rename-service] Restored files but failed to mark batch undone', error);
      warnings.push(
        `Items were restored, but history could not be updated (${errorMessage(error, 'unknown database error')}).`,
      );
    }
    return { batchId, restoredCount: reversedItems.length, success: true, errors: [], warnings };
  });
}
