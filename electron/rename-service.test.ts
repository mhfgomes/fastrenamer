import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listHistoryWithUndoStatus, undoRenameBatch } from './rename-service';
import { runRenamePlan } from './rename-plan';

describe('runRenamePlan', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('renames nested directories and files without losing child targets', async () => {
    const originalDir = path.join(tempRoot, 'Parent Folder');
    const originalFile = path.join(originalDir, 'Quarterly Report.txt');
    const renamedDir = path.join(tempRoot, 'parent_folder');
    const renamedFile = path.join(renamedDir, 'quarterly_report.txt');

    await fs.mkdir(originalDir, { recursive: true });
    await fs.writeFile(originalFile, 'report');

    await runRenamePlan('linux', [
      {
        sourcePath: originalDir,
        targetPath: renamedDir,
        isDirectory: true,
      },
      {
        sourcePath: originalFile,
        targetPath: renamedFile,
        isDirectory: false,
      },
    ]);

    await expect(fs.stat(renamedDir)).resolves.toBeTruthy();
    await expect(fs.readFile(renamedFile, 'utf8')).resolves.toBe('report');
  });

  it('handles case-only file renames through the temp staging path', async () => {
    const originalFile = path.join(tempRoot, 'Sample.txt');
    const renamedFile = path.join(tempRoot, 'sample.txt');
    await fs.writeFile(originalFile, 'case only');

    await runRenamePlan('darwin', [
      {
        sourcePath: originalFile,
        targetPath: renamedFile,
        isDirectory: false,
      },
    ]);

    await expect(fs.readFile(renamedFile, 'utf8')).resolves.toBe('case only');
  });
});

describe('undoRenameBatch safety checks', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-undo-'));
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('blocks undo when the current renamed path is missing', async () => {
    const originalPath = path.join(tempRoot, 'alpha.txt');
    const currentPath = path.join(tempRoot, 'beta.txt');

    const result = await undoRenameBatch(1, 'linux', {
      listHistory: () => [
        {
          id: 1,
          createdAt: new Date().toISOString(),
          renamedCount: 1,
          sourceRoots: [tempRoot],
          rules: [],
          previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
          canUndo: true,
          undoState: 'ready',
          undoReason: undefined,
        },
      ],
      getBatchItems: () => [
        { sourcePath: originalPath, targetPath: currentPath, isDirectory: false },
      ],
      getUndoReadyBatchItems: () => [],
      markBatchUndone: () => undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Files not found at current renamed path');
  });

  it('blocks undo when the original restore target is now occupied', async () => {
    const originalPath = path.join(tempRoot, 'alpha.txt');
    const currentPath = path.join(tempRoot, 'beta.txt');

    await fs.writeFile(originalPath, 'new occupant');
    await fs.writeFile(currentPath, 'renamed file');

    const result = await undoRenameBatch(2, 'linux', {
      listHistory: () => [
        {
          id: 2,
          createdAt: new Date().toISOString(),
          renamedCount: 1,
          sourceRoots: [tempRoot],
          rules: [],
          previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
          canUndo: true,
          undoState: 'ready',
          undoReason: undefined,
        },
      ],
      getBatchItems: () => [
        { sourcePath: originalPath, targetPath: currentPath, isDirectory: false },
      ],
      getUndoReadyBatchItems: () => [],
      markBatchUndone: () => undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Restore target is occupied');
  });

  it('blocks undo when paths overlap with another undo-ready batch', async () => {
    const originalPath = path.join(tempRoot, 'alpha.txt');
    const currentPath = path.join(tempRoot, 'beta.txt');
    const newerPath = path.join(tempRoot, 'gamma.txt');

    await fs.writeFile(currentPath, 'renamed file');

    const result = await undoRenameBatch(1, 'linux', {
      listHistory: () => [
        {
          id: 1,
          createdAt: new Date().toISOString(),
          renamedCount: 1,
          sourceRoots: [tempRoot],
          rules: [],
          previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
          canUndo: true,
          undoState: 'ready',
          undoReason: undefined,
        },
        {
          id: 2,
          createdAt: new Date().toISOString(),
          renamedCount: 1,
          sourceRoots: [tempRoot],
          rules: [],
          previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
          canUndo: true,
          undoState: 'ready',
          undoReason: undefined,
        },
      ],
      getBatchItems: () => [
        { sourcePath: originalPath, targetPath: currentPath, isDirectory: false },
      ],
      getUndoReadyBatchItems: () => [
        {
          batchId: 2,
          sourcePath: currentPath,
          targetPath: newerPath,
          isDirectory: false,
        },
      ],
      markBatchUndone: () => undefined,
    });

    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Overlaps with newer undo-ready batches: 2');
  });

  it('marks older overlapping batches as blocked in history while the newest stays ready', () => {
    const alpha = path.join(tempRoot, 'alpha.txt');
    const beta = path.join(tempRoot, 'beta.txt');
    const gamma = path.join(tempRoot, 'gamma.txt');

    return fs.writeFile(gamma, 'latest rename').then(() => {
      const history = listHistoryWithUndoStatus('linux', {
        listHistory: () => [
          {
            id: 2,
            createdAt: new Date().toISOString(),
            renamedCount: 1,
            sourceRoots: [tempRoot],
            rules: [],
            previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
            canUndo: true,
            undoState: 'ready',
            undoReason: undefined,
          },
          {
            id: 1,
            createdAt: new Date().toISOString(),
            renamedCount: 1,
            sourceRoots: [tempRoot],
            rules: [],
            previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
            canUndo: true,
            undoState: 'ready',
            undoReason: undefined,
          },
        ],
        getBatchItems: (batchId) =>
          batchId === 2
            ? [{ sourcePath: beta, targetPath: gamma, isDirectory: false }]
            : [{ sourcePath: alpha, targetPath: beta, isDirectory: false }],
        getUndoReadyBatchItems: (excludeBatchId) =>
          excludeBatchId === 2
            ? [{ batchId: 1, sourcePath: alpha, targetPath: beta, isDirectory: false }]
            : [{ batchId: 2, sourcePath: beta, targetPath: gamma, isDirectory: false }],
        markBatchUndone: () => undefined,
      });

      expect(history[0].undoState).toBe('ready');
      expect(history[0].canUndo).toBe(true);
      expect(history[1].undoState).toBe('overlap');
      expect(history[1].canUndo).toBe(false);
    });
  });
});
