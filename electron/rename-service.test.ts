import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HistoryEntry, PlatformTarget, RenameBatchRecord } from '@fastrenamer/rename-engine';
import { AppDatabase } from './db';
import {
  OperationBusyError,
  PLAN_CHANGED_MESSAGE,
  PreviewSupersededError,
  createLatestPreviewRunner,
  executeRenameBatch,
  generatePreviewForRequest,
  inProcessPlanner,
  listHistoryWithUndoStatus,
  loadDirectoryListing,
  undoRenameBatch,
  withFileOperationLock,
} from './rename-service';
import type { PreviewPlanner, ServicePreviewRequest } from './rename-service';
import type { RecordedRenameItem } from './rename-plan';

let tempRoot: string;
// Real-disk round trips must use the host's case rules (macOS temp dirs are case-insensitive).
const hostPlatform = process.platform as PlatformTarget;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-service-'));
});

afterEach(async () => {
  await fs.chmod(tempRoot, 0o755).catch(() => undefined);
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function historyEntry(id: number): HistoryEntry {
  return {
    id,
    createdAt: new Date().toISOString(),
    renamedCount: 1,
    sourceRoots: [tempRoot],
    rules: [],
    previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
    canUndo: true,
    undoState: 'ready',
    undoReason: undefined,
  };
}

function memoryStore(
  batches: Record<number, RecordedRenameItem[]>,
  undoReady: Array<RenameBatchRecord & { batchId: number }> = [],
) {
  const undone = new Set<number>();
  return {
    listHistory: () =>
      Object.keys(batches)
        .map(Number)
        .sort((left, right) => right - left)
        .map((id) => historyEntry(id)),
    getBatch: (id: number) =>
      batches[id]
        ? { ...historyEntry(id), ...(undone.has(id) ? { undoState: 'archived' as const, canUndo: false } : {}) }
        : undefined,
    getBatchItems: (id: number) => batches[id] ?? [],
    getUndoReadyBatchItems: (excludeBatchId?: number) =>
      undoReady.filter((item) => item.batchId !== excludeBatchId && !undone.has(item.batchId)),
    markBatchUndone: (id: number) => {
      undone.add(id);
    },
  };
}

function request(overrides: Partial<ServicePreviewRequest> = {}): ServicePreviewRequest {
  return {
    sourcePaths: [tempRoot],
    sourceMode: 'top_level_files',
    fileNamePattern: '',
    sortMode: 'natural_path',
    rules: [{ id: 'upper', type: 'case_transform', enabled: true, mode: 'upper' }],
    platform: hostPlatform,
    ...overrides,
  };
}

async function openDatabase() {
  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-service-db-'));
  const database = new AppDatabase(path.join(dbDir, 'db.sqlite'));
  return {
    database,
    cleanup: async () => {
      database.close();
      await fs.rm(dbDir, { recursive: true, force: true });
    },
  };
}

describe('undoRenameBatch safety checks', () => {
  it('blocks undo when the current renamed path is missing', async () => {
    const result = await undoRenameBatch(
      1,
      'linux',
      memoryStore({
        1: [{ sourcePath: path.join(tempRoot, 'alpha.txt'), targetPath: path.join(tempRoot, 'beta.txt'), isDirectory: false }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Files not found at current renamed path');
  });

  it('blocks undo when the original restore target is now occupied', async () => {
    const originalPath = path.join(tempRoot, 'alpha.txt');
    const currentPath = path.join(tempRoot, 'beta.txt');
    await fs.writeFile(originalPath, 'new occupant');
    await fs.writeFile(currentPath, 'renamed file');

    const result = await undoRenameBatch(
      2,
      'linux',
      memoryStore({ 2: [{ sourcePath: originalPath, targetPath: currentPath, isDirectory: false }] }),
    );
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Restore target is occupied');
  });

  it('blocks undo when paths overlap with another undo-ready batch', async () => {
    const originalPath = path.join(tempRoot, 'alpha.txt');
    const currentPath = path.join(tempRoot, 'beta.txt');
    await fs.writeFile(currentPath, 'renamed file');

    const result = await undoRenameBatch(
      1,
      'linux',
      memoryStore({ 1: [{ sourcePath: originalPath, targetPath: currentPath, isDirectory: false }], 2: [] }, [
        { batchId: 2, sourcePath: currentPath, targetPath: path.join(tempRoot, 'gamma.txt'), isDirectory: false },
      ]),
    );
    expect(result.success).toBe(false);
    expect(result.errors.join(' ')).toContain('Overlaps with newer undo-ready batches: 2');
  });

  it('marks older overlapping batches as blocked in history while the newest stays ready', async () => {
    const alpha = path.join(tempRoot, 'alpha.txt');
    const beta = path.join(tempRoot, 'beta.txt');
    const gamma = path.join(tempRoot, 'gamma.txt');
    await fs.writeFile(gamma, 'latest rename');

    const history = await listHistoryWithUndoStatus(
      'linux',
      memoryStore(
        {
          2: [{ sourcePath: beta, targetPath: gamma, isDirectory: false }],
          1: [{ sourcePath: alpha, targetPath: beta, isDirectory: false }],
        },
        [
          { batchId: 2, sourcePath: beta, targetPath: gamma, isDirectory: false },
          { batchId: 1, sourcePath: alpha, targetPath: beta, isDirectory: false },
        ],
      ),
    );

    expect(history[0].undoState).toBe('ready');
    expect(history[0].canUndo).toBe(true);
    expect(history[1].undoState).toBe('overlap');
    expect(history[1].canUndo).toBe(false);
  });
});

describe('execute and undo end to end', () => {
  it('executes the approved plan, records fingerprints, and undoes it', async () => {
    await fs.writeFile(path.join(tempRoot, 'a.txt'), 'a');
    const { database, cleanup } = await openDatabase();
    try {
      const preview = await generatePreviewForRequest(request());
      expect(preview.planId).toMatch(/^[0-9a-f]{64}$/);

      const result = await executeRenameBatch({ ...request(), planId: preview.planId }, database);
      expect(result.errors).toEqual([]);
      expect(result.renamedCount).toBe(1);
      expect(result.historyRecorded).toBe(true);
      expect(await fs.readdir(tempRoot)).toEqual(['A.txt']);
      expect(database.getBatchItems(result.batchId as number)[0].fingerprint?.ino).toBeTruthy();

      const undo = await undoRenameBatch(result.batchId as number, hostPlatform, database, database);
      expect(undo).toMatchObject({ success: true, restoredCount: 1 });
      expect(await fs.readdir(tempRoot)).toEqual(['a.txt']);

      const again = await undoRenameBatch(result.batchId as number, hostPlatform, database, database);
      expect(again.success).toBe(false);
      expect(again.errors[0]).toMatch(/already undone/);
    } finally {
      await cleanup();
    }
  });

  it('refuses to execute when the regenerated plan differs from the approved planId', async () => {
    await fs.writeFile(path.join(tempRoot, 'a.txt'), 'a');
    const { database, cleanup } = await openDatabase();
    try {
      const preview = await generatePreviewForRequest(request());
      await fs.writeFile(path.join(tempRoot, 'b.txt'), 'b'); // new file appears after preview

      const result = await executeRenameBatch({ ...request(), planId: preview.planId }, database);
      expect(result.planChanged).toBe(true);
      expect(result.errors).toEqual([PLAN_CHANGED_MESSAGE]);
      expect(result.renamedCount).toBe(0);
      expect(result.planId).not.toBe(preview.planId);
      expect((await fs.readdir(tempRoot)).sort()).toEqual(['a.txt', 'b.txt']);
    } finally {
      await cleanup();
    }
  });

  it('reports a history failure as a warning, not as a failed rename', async () => {
    await fs.writeFile(path.join(tempRoot, 'a.txt'), 'a');
    const { database, cleanup } = await openDatabase();
    try {
      const preview = await generatePreviewForRequest(request());
      const failingStore = {
        beginJournal: database.beginJournal.bind(database),
        finishJournal: database.finishJournal.bind(database),
        recordRenameBatch: () => {
          throw new Error('disk I/O error');
        },
      };
      const result = await executeRenameBatch({ ...request(), planId: preview.planId }, failingStore);
      expect(result.renamedCount).toBe(1);
      expect(result.blocked).toBe(false);
      expect(result.errors).toEqual([]);
      expect(result.historyRecorded).toBe(false);
      expect(result.warnings[0]).toMatch(/renamed, but .*disk I\/O error/);
      expect(await fs.readdir(tempRoot)).toEqual(['A.txt']);
    } finally {
      await cleanup();
    }
  });

  it('refuses undo when the renamed file was replaced by a different file', async () => {
    await fs.writeFile(path.join(tempRoot, 'a.txt'), 'a');
    const { database, cleanup } = await openDatabase();
    try {
      const preview = await generatePreviewForRequest(request());
      const result = await executeRenameBatch({ ...request(), planId: preview.planId }, database);
      // Replace A.txt with a different file of the same name.
      await fs.rename(path.join(tempRoot, 'A.txt'), path.join(tempRoot, 'kept-elsewhere'));
      await fs.writeFile(path.join(tempRoot, 'A.txt'), 'replacement');

      const history = await listHistoryWithUndoStatus(hostPlatform, database);
      expect(history[0]).toMatchObject({ canUndo: false, undoState: 'missing' });
      expect(history[0].undoReason).toMatch(/replaced/);

      const undo = await undoRenameBatch(result.batchId as number, hostPlatform, database, database);
      expect(undo.success).toBe(false);
      await expect(fs.readFile(path.join(tempRoot, 'A.txt'), 'utf8')).resolves.toBe('replacement');
    } finally {
      await cleanup();
    }
  });
});

describe('file operation lock', () => {
  it('rejects a second execute/undo while one is running', async () => {
    let release: () => void = () => undefined;
    const first = withFileOperationLock('rename', () => new Promise<void>((resolve) => (release = resolve)));
    await expect(undoRenameBatch(1, 'linux', memoryStore({}))).rejects.toBeInstanceOf(OperationBusyError);
    await expect(
      executeRenameBatch({ ...request(), planId: '0'.repeat(64) }, {
        beginJournal: () => 1,
        finishJournal: () => undefined,
        recordRenameBatch: () => 1,
      }),
    ).rejects.toThrow(/Another rename is still running/);
    release();
    await first;
    // Lock released afterwards.
    await expect(undoRenameBatch(1, 'linux', memoryStore({}))).resolves.toMatchObject({ success: false });
  });
});

describe('directory scanning', () => {
  it('skips hidden entries by default and includes them on request', async () => {
    await fs.mkdir(path.join(tempRoot, '.git', 'objects'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, '.git', 'objects', 'pack'), 'x');
    await fs.writeFile(path.join(tempRoot, '.DS_Store'), 'x');
    await fs.writeFile(path.join(tempRoot, 'visible.txt'), 'x');

    const hidden = await generatePreviewForRequest(request({ sourceMode: 'files_recursive' }));
    expect(hidden.rows.map((row) => row.originalName)).toEqual(['visible.txt']);

    const all = await generatePreviewForRequest(request({ sourceMode: 'files_recursive', includeHidden: true }));
    expect(all.rows.map((row) => row.originalName).sort()).toEqual(['.DS_Store', 'pack', 'visible.txt']);

    const listing = await loadDirectoryListing(tempRoot);
    expect(listing.items.map((item) => item.name)).toEqual(['visible.txt']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'skips unreadable folders and counts them instead of failing',
    async () => {
      await fs.mkdir(path.join(tempRoot, 'locked'));
      await fs.writeFile(path.join(tempRoot, 'locked', 'secret.txt'), 'x');
      await fs.mkdir(path.join(tempRoot, 'open'));
      await fs.writeFile(path.join(tempRoot, 'open', 'file.txt'), 'x');
      await fs.chmod(path.join(tempRoot, 'locked'), 0o000);
      try {
        const preview = await generatePreviewForRequest(request({ sourceMode: 'files_recursive' }));
        expect(preview.rows.map((row) => row.originalName)).toEqual(['file.txt']);
        expect(preview.skippedDirectories).toBe(1);

        const listing = await loadDirectoryListing(tempRoot);
        expect(listing.skippedDirectories).toBe(1);
        expect(listing.directChildren).toBe(2);
      } finally {
        await fs.chmod(path.join(tempRoot, 'locked'), 0o755);
      }
    },
  );

  it('caps the recursive count instead of walking the whole tree', async () => {
    for (let index = 0; index < 5; index += 1) {
      await fs.mkdir(path.join(tempRoot, `dir-${index}`));
      for (let file = 0; file < 5; file += 1) {
        await fs.writeFile(path.join(tempRoot, `dir-${index}`, `f-${file}`), '');
      }
    }
    const capped = await loadDirectoryListing(tempRoot, { countLimit: 12 });
    expect(capped).toMatchObject({ recursiveChildren: 12, recursiveChildrenTruncated: true, directChildren: 5 });

    const full = await loadDirectoryListing(tempRoot);
    expect(full).toMatchObject({ recursiveChildren: 30, recursiveChildrenTruncated: false });
  });
});

describe('createLatestPreviewRunner', () => {
  it('supersedes an older in-flight preview', async () => {
    await fs.writeFile(path.join(tempRoot, 'a.txt'), 'a');
    const pending: Array<() => void> = [];
    const slowPlanner: PreviewPlanner = (input, signal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
        pending.push(() => void inProcessPlanner(input).then(resolve));
      });
    const run = createLatestPreviewRunner(slowPlanner);

    const first = run(request()).catch((error: unknown) => error);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = run(request());
    await new Promise((resolve) => setTimeout(resolve, 20));
    pending.forEach((resume) => resume());

    expect(await first).toBeInstanceOf(PreviewSupersededError);
    await expect(second).resolves.toMatchObject({ summary: { total: 1 } });
  });
});
