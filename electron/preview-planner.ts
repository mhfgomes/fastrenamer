import crypto from 'node:crypto';
import fs from 'node:fs';
import { generatePreview, sortItemsByMode } from '@fastrenamer/rename-engine';
import type {
  PlatformTarget,
  PreviewResult,
  RenameRule,
  ResolvedRenameItem,
  SortMode,
} from '@fastrenamer/rename-engine';

/** Everything the CPU-bound planning step needs. Must stay structured-clone friendly (worker input). */
export interface PlanPreviewInput {
  items: ResolvedRenameItem[];
  rules: RenameRule[];
  platform: PlatformTarget;
  sortMode: SortMode;
  fileNamePattern: string;
}

function escapeFilePattern(pattern: string) {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*+/g, '.*')
    .replace(/\?/g, '.');
}

export function compileFilePatterns(input: string) {
  return input
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((pattern) => new RegExp(`^${escapeFilePattern(pattern)}$`, 'i'));
}

/**
 * Filters, sorts and plans the rename. Runs user-supplied regular expressions and custom rules, so
 * the main process only calls it inside a worker with a timeout (see preview-worker.ts).
 */
export function planPreview(input: PlanPreviewInput): PreviewResult {
  const patterns = compileFilePatterns(input.fileNamePattern);
  const items =
    patterns.length === 0
      ? input.items
      : input.items.filter((item) => item.isDirectory || patterns.some((pattern) => pattern.test(item.name)));

  return generatePreview({
    items: sortItemsByMode(items, input.sortMode),
    rules: input.rules,
    platform: input.platform,
    sortMode: input.sortMode,
    existingPathExists: (candidatePath) => fs.existsSync(candidatePath),
  });
}

/**
 * Identity of a plan: SHA-256 over the ordered list of changed rows plus the blocked flag. Two
 * previews with the same planId rename exactly the same items to exactly the same paths.
 */
export function computePlanId(preview: PreviewResult) {
  const changed = preview.rows
    .filter((row) => row.changed)
    .map((row) => [row.sourcePath, row.nextPath, row.isDirectory ? 1 : 0]);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ v: 1, blocked: preview.summary.blocked, changed }))
    .digest('hex');
}
