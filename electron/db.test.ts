import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AppDatabase, DatabaseVersionError, HISTORY_RETENTION_LIMIT, SCHEMA_VERSION, openAppDatabase } from './db';

const tempDirs: string[] = [];
const openDatabases: AppDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTestDatabase() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-renamer-db-'));
  tempDirs.push(tempDir);
  const database = new AppDatabase(path.join(tempDir, 'test.sqlite'));
  openDatabases.push(database);
  return database;
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

describe('AppDatabase robustness', () => {
  function tempDatabasePath() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-renamer-db-'));
    tempDirs.push(tempDir);
    return path.join(tempDir, 'test.sqlite');
  }

  it('enables WAL and stamps the current schema version', () => {
    const databasePath = tempDatabasePath();
    new AppDatabase(databasePath).close();
    const raw = new DatabaseSync(databasePath);
    expect((raw.prepare('PRAGMA journal_mode;').get() as { journal_mode: string }).journal_mode).toBe('wal');
    expect((raw.prepare('PRAGMA user_version;').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    raw.close();
  });

  it('records a batch atomically: a failing item leaves no partial batch behind', () => {
    const database = createTestDatabase();
    expect(() =>
      database.recordRenameBatch({
        sourceRoots: ['/tmp/x'],
        rules: [],
        previewSummary: { total: 2, changed: 2, ok: 2, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
        renamedCount: 2,
        items: [
          { sourcePath: '/tmp/x/a', targetPath: '/tmp/x/b', isDirectory: false },
          // NOT NULL violation on the second item
          { sourcePath: null as unknown as string, targetPath: '/tmp/x/d', isDirectory: false },
        ],
      }),
    ).toThrow();
    expect(database.listHistory()).toHaveLength(0);
    expect(database.getUndoReadyBatchItems()).toHaveLength(0);
  });

  it('stores and returns item fingerprints', () => {
    const database = createTestDatabase();
    const fingerprint = { dev: '1', ino: '42', size: '3', mtimeNs: '100', isDirectory: false };
    const batchId = database.recordRenameBatch({
      sourceRoots: ['/tmp/x'],
      rules: [],
      previewSummary: { total: 1, changed: 1, ok: 1, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
      renamedCount: 1,
      items: [{ sourcePath: '/tmp/x/a', targetPath: '/tmp/x/b', isDirectory: false, fingerprint }],
    });
    expect(database.getBatchItems(batchId)[0].fingerprint).toEqual(fingerprint);
  });

  it('looks up batches older than the history list window directly', () => {
    const database = createTestDatabase();
    const first = recordBatch(database, 'first');
    for (let index = 0; index < 60; index += 1) {
      recordBatch(database, `later-${index}`);
    }
    database.markBatchUndone(first);
    expect(database.listHistory().some((entry) => entry.id === first)).toBe(false);
    expect(database.getBatch(first)?.undoState).toBe('archived');
    expect(database.getBatch(99_999)).toBeUndefined();
  });

  it('migrates a version 2 database in place', () => {
    const databasePath = tempDatabasePath();
    const raw = new DatabaseSync(databasePath);
    raw.exec(`
      CREATE TABLE presets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0,
        rules_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE rename_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, source_roots_json TEXT NOT NULL,
        rules_json TEXT NOT NULL DEFAULT '[]', preview_summary_json TEXT NOT NULL, renamed_count INTEGER NOT NULL, undone_at TEXT);
      CREATE TABLE rename_batch_items (id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES rename_batches(id) ON DELETE CASCADE,
        source_path TEXT NOT NULL, target_path TEXT NOT NULL, is_directory INTEGER NOT NULL);
      INSERT INTO rename_batches (created_at, source_roots_json, preview_summary_json, renamed_count)
        VALUES ('2025-01-01T00:00:00.000Z', '["/tmp/old"]', '{"total":1,"changed":1,"ok":1,"conflict":0,"invalid":0,"unchanged":0,"blocked":false}', 1);
      INSERT INTO rename_batch_items (batch_id, source_path, target_path, is_directory) VALUES (1, '/tmp/old/a', '/tmp/old/b', 0);
      PRAGMA user_version = 2;
    `);
    raw.close();

    const database = new AppDatabase(databasePath);
    expect(database.getBatch(1)?.sourceRoots).toEqual(['/tmp/old']);
    expect(database.getBatchItems(1)).toEqual([
      { sourcePath: '/tmp/old/a', targetPath: '/tmp/old/b', isDirectory: false, fingerprint: null },
    ]);
    expect(database.listUnfinishedJournals()).toEqual([]);
    database.close();
  });

  it('refuses to open a database from a newer app version and leaves it untouched', () => {
    const databasePath = tempDatabasePath();
    const raw = new DatabaseSync(databasePath);
    raw.exec(`CREATE TABLE future (x); PRAGMA user_version = ${SCHEMA_VERSION + 1};`);
    raw.close();
    const before = fs.readFileSync(databasePath);

    expect(() => openAppDatabase(databasePath)).toThrow(DatabaseVersionError);
    expect(fs.readFileSync(databasePath).equals(before)).toBe(true);
    expect(fs.readdirSync(path.dirname(databasePath)).some((name) => name.includes('.corrupt-'))).toBe(false);
  });

  it('moves a corrupt database aside and starts fresh', () => {
    const databasePath = tempDatabasePath();
    fs.writeFileSync(databasePath, 'this is definitely not an sqlite database'.repeat(200));

    const { database, notice } = openAppDatabase(databasePath);
    expect(notice).toMatch(/could not be opened/);
    expect(database.listPresets().length).toBeGreaterThan(0);
    database.close();

    const backups = fs.readdirSync(path.dirname(databasePath)).filter((name) => name.includes('.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(fs.readFileSync(path.join(path.dirname(databasePath), backups[0]), 'utf8')).toMatch(/^this is definitely/);
  });

  it('tracks rename journals until they finish', () => {
    const database = createTestDatabase();
    const fingerprint = { dev: '1', ino: '2', size: '0', mtimeNs: '0', isDirectory: false };
    const id = database.beginJournal('execute', [
      { sourcePath: '/a', targetPath: '/b', tempName: '.frtmp-000000000000', isDirectory: false, fingerprint },
    ]);
    expect(database.listUnfinishedJournals().map((journal) => journal.id)).toEqual([id]);
    database.finishJournal(id, 'rollback_failed', 'oops');
    expect(database.listUnfinishedJournals()[0].message).toBe('oops');
    database.finishJournal(id, 'recovered');
    expect(database.listUnfinishedJournals()).toEqual([]);
    expect(database.getJournal(id)?.status).toBe('recovered');
  });
});
