import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase, HISTORY_RETENTION_LIMIT } from './db';

const tempDirs: string[] = [];

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTestDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-renamer-db-'));
  tempDirs.push(tempDir);
  return new AppDatabase(path.join(tempDir, 'test.sqlite'));
}

function recordBatch(database: AppDatabase, label: string) {
  return database.recordRenameBatch({
    sourceRoots: [`/tmp/${label}`],
    rules: [],
    previewSummary: {
      total: 1,
      changed: 1,
      ok: 1,
      conflict: 0,
      invalid: 0,
      unchanged: 0,
      blocked: false,
    },
    renamedCount: 1,
    items: [
      {
        sourcePath: `/tmp/${label}/before.txt`,
        targetPath: `/tmp/${label}/after.txt`,
        isDirectory: false,
      },
    ],
  });
}

describe('AppDatabase history retention', () => {
  it('prunes rename batches beyond the retention limit', () => {
    const database = createTestDatabase();

    for (let index = 0; index < HISTORY_RETENTION_LIMIT + 5; index += 1) {
      recordBatch(database, `batch-${index}`);
    }

    const history = database.listHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.sourceRoots[0]).toBe(`/tmp/batch-${HISTORY_RETENTION_LIMIT + 4}`);
  });
});
