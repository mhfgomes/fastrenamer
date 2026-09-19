import fs from 'node:fs';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import {
  compareNatural,
  generatePreview,
  normalizePathKey,
  sortItemsByMode,
} from '@fast-renamer/rename-engine';
import type {
  ExecuteRenameBatchRequest,
  ExecuteRenameBatchResult,
  HistoryEntry,
  PlatformTarget,
  PreviewRequest,
  PreviewResult,
  RenameBatchRecord,
  ResolvedRenameItem,
  SourceMode,
  SourceSelection,
  UndoRenameBatchResult,
} from '@fast-renamer/rename-engine';
import { runRenamePlan } from './rename-plan';

interface RenameExecutionStore {
  recordRenameBatch(input: {
    sourceRoots: string[];
    rules: PreviewRequest['rules'];
    previewSummary: PreviewResult['summary'];
    renamedCount: number;
    items: RenameBatchRecord[];
  }): number;
}

interface RenameUndoStore {
  listHistory(): HistoryEntry[];
  getBatchItems(batchId: number): RenameBatchRecord[];
  getUndoReadyBatchItems(excludeBatchId?: number): Array<RenameBatchRecord & { batchId: number }>;
  markBatchUndone(batchId: number): void;
}

interface UndoPreflightIssue {
  code: 'missing' | 'occupied' | 'overlap';
  message: string;
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

export async function loadDirectoryListing(sourcePath: string) {
  const directEntries = await fsp.readdir(sourcePath, { withFileTypes: true });
  const items: SourceSelection[] = directEntries
    .map((entry) => ({
      path: path.join(sourcePath, entry.name),
      name: entry.name,
      parentPath: sourcePath,
      isDirectory: entry.isDirectory(),
    }))
    .sort((left, right) => compareNatural(left.path, right.path));

  let recursiveChildren = 0;
  const stack = items.filter((item) => item.isDirectory).map((item) => item.path);
  recursiveChildren += items.length;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const nestedEntries = await fsp.readdir(current, { withFileTypes: true });
    recursiveChildren += nestedEntries.length;
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
  };
}

async function resolveSourceItems(request: PreviewRequest): Promise<ResolvedRenameItem[]> {
  const seen = new Set<string>();
  const items: ResolvedRenameItem[] = [];
  const filePatterns = compileFilePatterns(request.fileNamePattern);

  const pushItem = async (
    itemPath: string,
    options: { requireDirectory?: boolean; requireFile?: boolean } = {},
  ) => {
    const stats = await fsp.stat(itemPath);
    const item: ResolvedRenameItem = {
      sourcePath: itemPath,
      name: path.basename(itemPath),
      parentPath: path.dirname(itemPath),
      isDirectory: stats.isDirectory(),
    };

    if (options.requireDirectory && !item.isDirectory) {
      return;
    }
    if (options.requireFile && item.isDirectory) {
      return;
    }
    if (!item.isDirectory && filePatterns.length > 0 && !matchesFilePatterns(item.name, filePatterns)) {
      return;
    }

    const key = normalizePathKey(item.sourcePath, request.platform);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push(item);
  };

  const walkMode = async (directoryPath: string, mode: SourceMode, depth = 1) => {
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    const orderedEntries = [...entries].sort((left, right) => compareNatural(left.name, right.name));
    for (const entry of orderedEntries) {
      const childPath = path.join(directoryPath, entry.name);
      switch (mode) {
        case 'top_level_folders':
          if (depth === 1 && entry.isDirectory()) {
            await pushItem(childPath, { requireDirectory: true });
          }
          break;
        case 'subfolders':
          if (entry.isDirectory()) {
            if (depth >= 2) {
              await pushItem(childPath, { requireDirectory: true });
            }
            await walkMode(childPath, mode, depth + 1);
          }
          break;
        case 'top_level_files':
          if (depth === 1 && entry.isFile()) {
            await pushItem(childPath, { requireFile: true });
          }
          break;
        case 'files_recursive':
          if (entry.isFile()) {
            await pushItem(childPath, { requireFile: true });
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
    const stats = await fsp.stat(sourcePath);
    if (request.sourceMode === 'picked_folders') {
      await pushItem(sourcePath, { requireDirectory: true });
      continue;
    }

    if (request.sourceMode === 'picked_files') {
      await pushItem(sourcePath, { requireFile: true });
      continue;
    }

    if (stats.isDirectory()) {
      await walkMode(sourcePath, request.sourceMode);
    }
  }

  return sortItemsByMode(items, request.sortMode);
}

function compileFilePatterns(input: string) {
  return input
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(`^${escapeFilePattern(pattern)}$`, 'i'));
}

function escapeFilePattern(pattern: string) {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
}

function matchesFilePatterns(fileName: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(fileName));
}


export async function generatePreviewForRequest(request: PreviewRequest): Promise<PreviewResult> {
  const items = await resolveSourceItems(request);
  return generatePreview({
    items,
    rules: request.rules,
    platform: request.platform,
    sortMode: request.sortMode,
    existingPathExists: (candidatePath) => fs.existsSync(candidatePath),
  });
}

export async function executeRenameBatch(
  request: ExecuteRenameBatchRequest,
  database: RenameExecutionStore,
): Promise<ExecuteRenameBatchResult> {
  const preview = await generatePreviewForRequest(request);
  if (preview.summary.blocked) {
    return {
      ...preview,
      batchId: null,
      renamedCount: 0,
      blocked: true,
      errors: ['Execution blocked because the preview contains conflicts or invalid names.'],
    };
  }

  const renamedRows = preview.rows.filter((row) => row.changed);
  const operations: RenameBatchRecord[] = renamedRows.map((row) => ({
    sourcePath: row.sourcePath,
    targetPath: row.nextPath,
    isDirectory: row.isDirectory,
  }));

  try {
    await runRenamePlan(request.platform, operations);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown filesystem error';
    return {
      ...preview,
      batchId: null,
      renamedCount: 0,
      blocked: true,
      errors: [`Rename execution failed: ${message}`],
    };
  }

  const batchId = database.recordRenameBatch({
    sourceRoots: [...request.sourcePaths],
    rules: request.rules,
    previewSummary: preview.summary,
    renamedCount: operations.length,
    items: operations,
  });

  return {
    ...preview,
    batchId,
    renamedCount: operations.length,
    blocked: false,
    errors: [],
  };
}

function buildUndoPreflightIssues(
  batchId: number,
  platform: PlatformTarget,
  batchItems: RenameBatchRecord[],
  otherUndoableItems: Array<RenameBatchRecord & { batchId: number }>,
) {
  const issues: UndoPreflightIssue[] = [];
  const currentKeys = new Set(
    batchItems.map((item) => normalizePathKey(item.targetPath, platform)),
  );
  const overlappingBatchIds = new Set<number>();
  const otherPathOwners = new Map<string, Set<number>>();

  for (const item of otherUndoableItems.filter((candidate) => candidate.batchId > batchId)) {
    const sourceKey = normalizePathKey(item.sourcePath, platform);
    const targetKey = normalizePathKey(item.targetPath, platform);
    if (!otherPathOwners.has(sourceKey)) {
      otherPathOwners.set(sourceKey, new Set());
    }
    if (!otherPathOwners.has(targetKey)) {
      otherPathOwners.set(targetKey, new Set());
    }
    otherPathOwners.get(sourceKey)?.add(item.batchId);
    otherPathOwners.get(targetKey)?.add(item.batchId);
  }

  for (const item of batchItems) {
    if (!fs.existsSync(item.targetPath)) {
      issues.push({
        code: 'missing',
        message: `Files not found at current renamed path: ${item.targetPath}`,
      });
    }

    const restoreKey = normalizePathKey(item.sourcePath, platform);
    if (fs.existsSync(item.sourcePath) && !currentKeys.has(restoreKey)) {
      issues.push({
        code: 'occupied',
        message: `Restore target is occupied: ${item.sourcePath}`,
      });
    }

    const currentOverlapOwners = otherPathOwners.get(normalizePathKey(item.targetPath, platform));
    const restoreOverlapOwners = otherPathOwners.get(restoreKey);
    currentOverlapOwners?.forEach((ownerBatchId) => overlappingBatchIds.add(ownerBatchId));
    restoreOverlapOwners?.forEach((ownerBatchId) => overlappingBatchIds.add(ownerBatchId));
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

function getUndoAvailability(
  entry: HistoryEntry,
  platform: PlatformTarget,
  database: RenameUndoStore,
): Pick<HistoryEntry, 'canUndo' | 'undoState' | 'undoReason'> {
  if (entry.undoState === 'archived') {
    return {
      canUndo: false,
      undoState: 'archived',
      undoReason: entry.undoReason ?? 'This batch was already undone.',
    };
  }

  const batchItems = database.getBatchItems(entry.id);
  const issues = buildUndoPreflightIssues(
    entry.id,
    platform,
    batchItems,
    database.getUndoReadyBatchItems(entry.id),
  );

  const overlapIssue = issues.find((issue) => issue.code === 'overlap');
  if (overlapIssue) {
    return { canUndo: false, undoState: 'overlap', undoReason: overlapIssue.message };
  }

  const occupiedIssue = issues.find((issue) => issue.code === 'occupied');
  if (occupiedIssue) {
    return { canUndo: false, undoState: 'occupied', undoReason: occupiedIssue.message };
  }

  const missingIssue = issues.find((issue) => issue.code === 'missing');
  if (missingIssue) {
    return { canUndo: false, undoState: 'missing', undoReason: missingIssue.message };
  }

  return {
    canUndo: true,
    undoState: 'ready',
    undoReason: undefined,
  };
}

export function listHistoryWithUndoStatus(
  platform: PlatformTarget,
  database: RenameUndoStore,
): HistoryEntry[] {
  return database.listHistory().map((entry) => ({
    ...entry,
    ...getUndoAvailability(entry, platform, database),
  }));
}

export async function undoRenameBatch(
  batchId: number,
  platform: PlatformTarget,
  database: RenameUndoStore,
): Promise<UndoRenameBatchResult> {
  const batchItems = database.getBatchItems(batchId);
  if (batchItems.length === 0) {
    return {
      batchId,
      restoredCount: 0,
      success: false,
      errors: [`Batch #${batchId} does not exist or has no recorded items.`],
    };
  }

  const historyEntry = database.listHistory().find((entry) => entry.id === batchId) ?? {
    id: batchId,
    createdAt: '',
    renamedCount: batchItems.length,
    sourceRoots: [],
    rules: [],
    previewSummary: { total: 0, changed: 0, ok: 0, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
    canUndo: true,
    undoState: 'ready' as const,
    undoReason: undefined,
  };

  const availability = getUndoAvailability(historyEntry, platform, database);
  if (!availability.canUndo) {
    return {
      batchId,
      restoredCount: 0,
      success: false,
      errors: [availability.undoReason ?? 'Undo is not available for this batch.'],
    };
  }

  const reversedItems = batchItems.map((item) => ({
    sourcePath: item.targetPath,
    targetPath: item.sourcePath,
    isDirectory: item.isDirectory,
  }));

  try {
    await runRenamePlan(platform, reversedItems);
    database.markBatchUndone(batchId);
    return {
      batchId,
      restoredCount: reversedItems.length,
      success: true,
      errors: [],
    };
  } catch (error) {
    return {
      batchId,
      restoredCount: 0,
      success: false,
      errors: [error instanceof Error ? error.message : 'Undo failed.'],
    };
  }
}
