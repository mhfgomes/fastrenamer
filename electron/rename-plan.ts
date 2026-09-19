import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { compareNatural, normalizePathKey } from '@fast-renamer/rename-engine';
import type { PlatformTarget, RenameBatchRecord } from '@fast-renamer/rename-engine';

interface RenameOperation extends RenameBatchRecord {
  tempName: string;
}

function pathDepth(candidatePath: string) {
  return candidatePath.split(path.sep).length;
}

function createTempName(originalPath: string, taken: Set<string>) {
  let candidate = `.fast-renamer-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${path.basename(originalPath)}`;
  while (taken.has(candidate)) {
    candidate = `.fast-renamer-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}-${path.basename(originalPath)}`;
  }
  taken.add(candidate);
  return candidate;
}

function buildOperations(items: RenameBatchRecord[]) {
  const tempNames = new Set<string>();
  return items.map(
    (item): RenameOperation => ({
      ...item,
      tempName: createTempName(item.sourcePath, tempNames),
    }),
  );
}

function resolvePathForState(
  originalPath: string,
  platform: PlatformTarget,
  operations: Map<string, RenameOperation>,
  stateMap: Map<string, 'source' | 'temp' | 'target'>,
  memo = new Map<string, string>(),
): string {
  const key = normalizePathKey(originalPath, platform);
  const cacheKey = `${key}:${stateMap.get(key) ?? 'source'}`;
  const cached = memo.get(cacheKey);
  if (cached) {
    return cached;
  }

  const operation = operations.get(key);
  if (operation) {
    const state = stateMap.get(key) ?? 'source';
    const parentResolved = resolvePathForState(path.dirname(operation.sourcePath), platform, operations, stateMap, memo);
    const name =
      state === 'temp'
        ? operation.tempName
        : state === 'target'
          ? path.basename(operation.targetPath)
          : path.basename(operation.sourcePath);
    const resolved = path.join(parentResolved, name);
    memo.set(cacheKey, resolved);
    return resolved;
  }

  const parentPath = path.dirname(originalPath);
  if (parentPath === originalPath) {
    memo.set(cacheKey, originalPath);
    return originalPath;
  }

  const resolvedParent = resolvePathForState(parentPath, platform, operations, stateMap, memo);
  const resolved =
    resolvedParent === parentPath ? originalPath : path.join(resolvedParent, path.basename(originalPath));
  memo.set(cacheKey, resolved);
  return resolved;
}

export async function runRenamePlan(platform: PlatformTarget, items: RenameBatchRecord[]) {
  const operationsList = buildOperations(items);
  const operations = new Map(
    operationsList.map((operation) => [normalizePathKey(operation.sourcePath, platform), operation]),
  );
  const stateMap = new Map<string, 'source' | 'temp' | 'target'>();

  const stageOne = [...operationsList].sort(
    (left, right) =>
      pathDepth(right.sourcePath) - pathDepth(left.sourcePath) ||
      compareNatural(right.sourcePath, left.sourcePath),
  );

  for (const operation of stageOne) {
    const sourceKey = normalizePathKey(operation.sourcePath, platform);
    const currentPath = resolvePathForState(operation.sourcePath, platform, operations, stateMap);
    const tempPath = path.join(path.dirname(currentPath), operation.tempName);
    await fsp.rename(currentPath, tempPath);
    stateMap.set(sourceKey, 'temp');
  }

  const stageTwo = [...operationsList].sort(
    (left, right) =>
      pathDepth(left.sourcePath) - pathDepth(right.sourcePath) ||
      compareNatural(left.sourcePath, right.sourcePath),
  );

  for (const operation of stageTwo) {
    const sourceKey = normalizePathKey(operation.sourcePath, platform);
    const currentPath = resolvePathForState(operation.sourcePath, platform, operations, stateMap);
    await fsp.rename(currentPath, operation.targetPath);
    stateMap.set(sourceKey, 'target');
  }
}
