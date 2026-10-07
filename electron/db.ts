import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type {
  HistoryEntry,
  Preset,
  PreviewSummary,
  RenameBatchRecord,
  RenameRule,
} from '@fastrenamer/rename-engine';
import type { PresetTransferEntry } from '../src/shared/contracts';
import type { FileFingerprint, JournalEntry, JournalKind, JournalStatus, RecordedRenameItem } from './rename-plan';
import type { JournalRecord, RenameJournalStore } from './rename-journal';

const SAMPLE_PRESETS: Array<{ name: string; rules: RenameRule[] }> = [
  {
    name: 'Clean Snake Case',
    rules: [
      {
        id: 'sample-trim',
        type: 'trim_text',
        enabled: true,
        mode: 'collapse_spaces',
      },
      {
        id: 'sample-snake',
        type: 'case_transform',
        enabled: true,
        mode: 'snake',
      },
      {
        id: 'sample-ext',
        type: 'extension_handling',
        enabled: true,
        mode: 'lowercase',
        replacement: '',
      },
    ],
  },
  {
    name: 'Timestamp Suffix',
    rules: [
      {
        id: 'sample-date',
        type: 'date_time',
        enabled: true,
        position: 'suffix',
        format: 'YYYY-MM-DD',
        separator: '_',
      },
    ],
  },
  {
    name: 'Sequential Prefix',
    rules: [
      {
        id: 'sample-seq',
        type: 'sequence_insert',
        enabled: true,
        position: 'prefix',
        start: 1,
        step: 1,
        padWidth: 3,
        separator: '_',
      },
    ],
  },
  {
    name: 'Template Rename',
    rules: [
      {
        id: 'sample-template',
        type: 'new_name',
        enabled: true,
        template: 'name_{seq_num:0001}',
      },
    ],
  },
  {
    name: 'Custom Rule Beta',
    rules: [
      {
        id: 'sample-custom',
        type: 'custom_rule',
        enabled: true,
        expression: 'snake(originalStem) + "_" + pad(index, 3) + ext(lower(extension))',
      },
    ],
  },
];

export const HISTORY_RETENTION_LIMIT = 100;
export const HISTORY_LIST_LIMIT = 50;
export const JOURNAL_RETENTION_LIMIT = 50;
/** Highest schema version this build understands. */
export const SCHEMA_VERSION = 3;

const UNFINISHED_JOURNAL_STATUSES: JournalStatus[] = ['in_progress', 'rollback_failed'];

/** The database was written by a newer Fast Renamer. It must not be touched or replaced. */
export class DatabaseVersionError extends Error {
  constructor(databasePath: string, version: number) {
    super(
      `The Fast Renamer database at ${databasePath} was created by a newer version of the app ` +
        `(schema ${version}; this version supports up to ${SCHEMA_VERSION}). ` +
        'Update Fast Renamer to the latest version to open it.',
    );
    this.name = 'DatabaseVersionError';
  }
}

/** The database file is damaged (SQLite reported corruption or the integrity check failed). */
export class DatabaseCorruptError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseCorruptError';
  }
}

/**
 * The database could not be opened for a reason other than corruption (locked by another
 * process, permissions, failed migration, ...). The file is left exactly as it was.
 */
export class DatabaseOpenError extends Error {
  constructor(databasePath: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const hint = isLockError(cause)
      ? 'It is in use by another process (is another copy of Fast Renamer running?). Close it and try again.'
      : 'Check that the file and its folder are readable and writable, then try again.';
    super(
      `The Fast Renamer database at ${databasePath} could not be opened (${reason}). ` +
        `${hint} The file was not modified, so your presets and rename history are still in it.`,
      { cause },
    );
    this.name = 'DatabaseOpenError';
  }
}

// Primary SQLite result codes (node:sqlite exposes them as `errcode`, possibly extended).
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;
const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

function sqlitePrimaryCode(error: unknown): number | null {
  const code = (error as { errcode?: unknown } | null)?.errcode;
  return typeof code === 'number' ? code & 0xff : null;
}

function isLockError(error: unknown) {
  const code = sqlitePrimaryCode(error);
  return code === SQLITE_BUSY || code === SQLITE_LOCKED;
}

/** Only confirmed corruption may cause the database to be moved aside. */
export function isDatabaseCorruptionError(error: unknown) {
  if (error instanceof DatabaseCorruptError) {
    return true;
  }
  const code = sqlitePrimaryCode(error);
  return code === SQLITE_CORRUPT || code === SQLITE_NOTADB;
}

export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

export interface AppDatabaseOptions {
  /** How long to wait for another connection's lock before failing (SQLite busy_timeout). */
  busyTimeoutMs?: number;
}

export function defaultDatabasePath() {
  return path.join(app.getPath('userData'), 'fast-renamer.sqlite');
}

export class AppDatabase implements RenameJournalStore {
  private database: DatabaseSync;
  private transactionDepth = 0;
  readonly databasePath: string;

  constructor(databasePath?: string, options: AppDatabaseOptions = {}) {
    const resolvedPath = databasePath ?? defaultDatabasePath();
    this.databasePath = resolvedPath;
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.database = new DatabaseSync(resolvedPath);
    try {
      const busyTimeoutMs = Math.max(0, Math.floor(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS));
      this.database.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
      const version = this.readUserVersion();
      if (version > SCHEMA_VERSION) {
        throw new DatabaseVersionError(resolvedPath, version);
      }
      const check = this.database.prepare('PRAGMA quick_check;').get() as Record<string, unknown> | undefined;
      const checkResult = check ? String(Object.values(check)[0]) : 'no result';
      if (checkResult !== 'ok') {
        throw new DatabaseCorruptError(`Database integrity check failed: ${checkResult}`);
      }
      this.database.exec('PRAGMA journal_mode = WAL;');
      this.database.exec('PRAGMA foreign_keys = ON;');
      this.migrate();
      this.seedSamplePresets();
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close() {
    try {
      this.database.close();
    } catch {
      // already closed
    }
  }

  /** Runs `task` atomically. Nested calls join the outer transaction. */
  transaction<T>(task: () => T): T {
    if (this.transactionDepth > 0) {
      return task();
    }
    this.database.exec('BEGIN IMMEDIATE;');
    this.transactionDepth += 1;
    try {
      const result = task();
      this.database.exec('COMMIT;');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK;');
      } catch {
        // The transaction may already have been rolled back by SQLite.
      }
      throw error;
    } finally {
      this.transactionDepth -= 1;
    }
  }

  private readUserVersion() {
    const versionRow = this.database.prepare('PRAGMA user_version;').get() as Record<string, unknown> | undefined;
    return Number(versionRow?.user_version ?? 0);
  }

  private migrate() {
    this.transaction(() => {
      let version = this.readUserVersion();

      if (version < 1) {
        this.database.exec(`
          CREATE TABLE IF NOT EXISTS presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            is_sample INTEGER NOT NULL DEFAULT 0,
            rules_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS rename_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            source_roots_json TEXT NOT NULL,
            rules_json TEXT NOT NULL DEFAULT '[]',
            preview_summary_json TEXT NOT NULL,
            renamed_count INTEGER NOT NULL,
            undone_at TEXT
          );

          CREATE TABLE IF NOT EXISTS rename_batch_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_id INTEGER NOT NULL REFERENCES rename_batches(id) ON DELETE CASCADE,
            source_path TEXT NOT NULL,
            target_path TEXT NOT NULL,
            is_directory INTEGER NOT NULL
          );
        `);
        version = 2;
      } else if (version < 2) {
        this.database.exec(`ALTER TABLE rename_batches ADD COLUMN rules_json TEXT NOT NULL DEFAULT '[]';`);
        version = 2;
      }

      if (version < 3) {
        this.database.exec(`
          ALTER TABLE rename_batch_items ADD COLUMN fingerprint_json TEXT;

          CREATE INDEX IF NOT EXISTS rename_batch_items_batch_id ON rename_batch_items(batch_id);

          CREATE TABLE IF NOT EXISTS rename_journals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            entries_json TEXT NOT NULL,
            message TEXT
          );

          CREATE INDEX IF NOT EXISTS rename_journals_status ON rename_journals(status);
        `);
        version = 3;
      }

      this.database.exec(`PRAGMA user_version = ${version};`);
    });
  }

  private seedSamplePresets() {
    const existingNames = new Set(
      (
        this.database
          .prepare('SELECT name FROM presets WHERE is_sample = 1')
          .all() as Array<Record<string, unknown>>
      ).map((row) => String(row.name)),
    );

    const insert = this.database.prepare(`
      INSERT INTO presets (name, is_sample, rules_json, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?)
    `);
    const now = new Date().toISOString();

    this.transaction(() => {
      for (const preset of SAMPLE_PRESETS) {
        if (existingNames.has(preset.name)) {
          continue;
        }
        insert.run(preset.name, JSON.stringify(preset.rules), now, now);
      }
    });
  }

  listPresets(): Preset[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, is_sample, created_at, updated_at, rules_json
         FROM presets
         ORDER BY is_sample DESC, updated_at DESC, name ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      isSample: Boolean(row.is_sample),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      rules: JSON.parse(String(row.rules_json)) as RenameRule[],
    }));
  }

  savePreset(input: { id?: number; name: string; rules: RenameRule[] }): Preset {
    const now = new Date().toISOString();

    if (input.id) {
      const existing = this.database
        .prepare('SELECT id, is_sample, created_at FROM presets WHERE id = ?')
        .get(input.id) as Record<string, unknown> | undefined;

      if (!existing) {
        throw new Error(`Preset ${input.id} does not exist.`);
      }
      if (Boolean(existing.is_sample)) {
        throw new Error('Sample presets are read-only.');
      }

      this.database
        .prepare(
          `UPDATE presets
           SET name = ?, rules_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.name, JSON.stringify(input.rules), now, input.id);

      return {
        id: input.id,
        name: input.name,
        isSample: false,
        createdAt: String(existing.created_at),
        updatedAt: now,
        rules: input.rules,
      };
    }

    const result = this.database
      .prepare(
        `INSERT INTO presets (name, is_sample, rules_json, created_at, updated_at)
         VALUES (?, 0, ?, ?, ?)`,
      )
      .run(input.name, JSON.stringify(input.rules), now, now);

    return {
      id: Number(result.lastInsertRowid),
      name: input.name,
      isSample: false,
      createdAt: now,
      updatedAt: now,
      rules: input.rules,
    };
  }

  listUserPresetTransfers(): PresetTransferEntry[] {
    return this.listPresets()
      .filter((preset) => !preset.isSample)
      .map((preset) => ({
        name: preset.name,
        rules: preset.rules,
      }));
  }

  getUserPresetTransfer(id: number): PresetTransferEntry {
    const row = this.database
      .prepare(
        `SELECT name, is_sample, rules_json
         FROM presets
         WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;

    if (!row) {
      throw new Error(`Preset ${id} does not exist.`);
    }
    if (Boolean(row.is_sample)) {
      throw new Error('Sample presets cannot be exported individually.');
    }

    return {
      name: String(row.name),
      rules: JSON.parse(String(row.rules_json)) as RenameRule[],
    };
  }

  importUserPresets(presets: PresetTransferEntry[]) {
    this.transaction(() => {
      for (const preset of presets) {
        this.savePreset({
          name: preset.name.trim(),
          rules: preset.rules,
        });
      }
    });

    return presets.length;
  }

  deletePreset(id: number) {
    const existing = this.database
      .prepare('SELECT is_sample FROM presets WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;

    if (!existing) {
      return;
    }
    if (Boolean(existing.is_sample)) {
      throw new Error('Sample presets cannot be deleted.');
    }

    this.database.prepare('DELETE FROM presets WHERE id = ?').run(id);
  }

  recordRenameBatch(input: {
    sourceRoots: string[];
    rules: RenameRule[];
    previewSummary: PreviewSummary;
    renamedCount: number;
    items: RecordedRenameItem[];
  }) {
    return this.transaction(() => {
      const now = new Date().toISOString();
      const batchResult = this.database
        .prepare(
          `INSERT INTO rename_batches (created_at, source_roots_json, rules_json, preview_summary_json, renamed_count)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          now,
          JSON.stringify(input.sourceRoots),
          JSON.stringify(input.rules),
          JSON.stringify(input.previewSummary),
          input.renamedCount,
        );

      const batchId = Number(batchResult.lastInsertRowid);
      const insertItem = this.database.prepare(
        `INSERT INTO rename_batch_items (batch_id, source_path, target_path, is_directory, fingerprint_json)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const item of input.items) {
        insertItem.run(
          batchId,
          item.sourcePath,
          item.targetPath,
          item.isDirectory ? 1 : 0,
          item.fingerprint ? JSON.stringify(item.fingerprint) : null,
        );
      }

      this.pruneOldBatches();

      return batchId;
    });
  }

  private pruneOldBatches() {
    const staleRows = this.database
      .prepare(
        `SELECT id
         FROM rename_batches
         ORDER BY created_at DESC, id DESC
         LIMIT -1 OFFSET ?`,
      )
      .all(HISTORY_RETENTION_LIMIT) as Array<Record<string, unknown>>;

    if (staleRows.length === 0) {
      return;
    }

    const deleteBatch = this.database.prepare('DELETE FROM rename_batches WHERE id = ?');
    this.transaction(() => {
      for (const row of staleRows) {
        deleteBatch.run(Number(row.id));
      }
    });
  }

  getBatchItems(batchId: number): RecordedRenameItem[] {
    const rows = this.database
      .prepare(
        `SELECT source_path, target_path, is_directory, fingerprint_json
         FROM rename_batch_items
         WHERE batch_id = ?
         ORDER BY LENGTH(source_path) DESC, source_path ASC`,
      )
      .all(batchId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      sourcePath: String(row.source_path),
      targetPath: String(row.target_path),
      isDirectory: Boolean(row.is_directory),
      fingerprint: row.fingerprint_json ? (JSON.parse(String(row.fingerprint_json)) as FileFingerprint) : null,
    }));
  }

  getUndoReadyBatchItems(excludeBatchId?: number): Array<RenameBatchRecord & { batchId: number }> {
    const rows = (
      excludeBatchId
        ? this.database
            .prepare(
              `SELECT batch_id, source_path, target_path, is_directory
               FROM rename_batch_items
               INNER JOIN rename_batches ON rename_batches.id = rename_batch_items.batch_id
               WHERE rename_batches.undone_at IS NULL AND rename_batch_items.batch_id != ?
               ORDER BY rename_batch_items.batch_id DESC, rename_batch_items.id ASC`,
            )
            .all(excludeBatchId)
        : this.database
            .prepare(
              `SELECT batch_id, source_path, target_path, is_directory
               FROM rename_batch_items
               INNER JOIN rename_batches ON rename_batches.id = rename_batch_items.batch_id
               WHERE rename_batches.undone_at IS NULL
               ORDER BY rename_batch_items.batch_id DESC, rename_batch_items.id ASC`,
            )
            .all()
    ) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      batchId: Number(row.batch_id),
      sourcePath: String(row.source_path),
      targetPath: String(row.target_path),
      isDirectory: Boolean(row.is_directory),
    }));
  }

  listHistory(): HistoryEntry[] {
    const rows = this.database
      .prepare(
        `SELECT id, created_at, source_roots_json, rules_json, preview_summary_json, renamed_count, undone_at
         FROM rename_batches
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(HISTORY_LIST_LIMIT) as Array<Record<string, unknown>>;

    return rows.map((row) => toHistoryEntry(row));
  }

  getBatch(batchId: number): HistoryEntry | undefined {
    const row = this.database
      .prepare(
        `SELECT id, created_at, source_roots_json, rules_json, preview_summary_json, renamed_count, undone_at
         FROM rename_batches
         WHERE id = ?`,
      )
      .get(batchId) as Record<string, unknown> | undefined;
    return row ? toHistoryEntry(row) : undefined;
  }

  markBatchUndone(batchId: number) {
    this.database
      .prepare('UPDATE rename_batches SET undone_at = ? WHERE id = ?')
      .run(new Date().toISOString(), batchId);
  }

  beginJournal(kind: JournalKind, entries: JournalEntry[]) {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `INSERT INTO rename_journals (created_at, updated_at, kind, status, entries_json)
         VALUES (?, ?, ?, 'in_progress', ?)`,
      )
      .run(now, now, kind, JSON.stringify(entries));
    return Number(result.lastInsertRowid);
  }

  finishJournal(journalId: number, status: JournalStatus, message?: string) {
    this.transaction(() => {
      this.database
        .prepare('UPDATE rename_journals SET status = ?, message = ?, updated_at = ? WHERE id = ?')
        .run(status, message ?? null, new Date().toISOString(), journalId);
      this.database
        .prepare(
          `DELETE FROM rename_journals
           WHERE status NOT IN (${UNFINISHED_JOURNAL_STATUSES.map(() => '?').join(', ')})
             AND id NOT IN (SELECT id FROM rename_journals ORDER BY id DESC LIMIT ?)`,
        )
        .run(...UNFINISHED_JOURNAL_STATUSES, JOURNAL_RETENTION_LIMIT);
    });
  }

  getJournal(journalId: number): JournalRecord | undefined {
    const row = this.database
      .prepare('SELECT id, created_at, kind, status, entries_json, message FROM rename_journals WHERE id = ?')
      .get(journalId) as Record<string, unknown> | undefined;
    return row ? toJournalRecord(row) : undefined;
  }

  listUnfinishedJournals(): JournalRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, created_at, kind, status, entries_json, message
         FROM rename_journals
         WHERE status IN (${UNFINISHED_JOURNAL_STATUSES.map(() => '?').join(', ')})
         ORDER BY id DESC`,
      )
      .all(...UNFINISHED_JOURNAL_STATUSES) as Array<Record<string, unknown>>;
    return rows.map((row) => toJournalRecord(row));
  }
}

function toHistoryEntry(row: Record<string, unknown>): HistoryEntry {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    renamedCount: Number(row.renamed_count),
    sourceRoots: JSON.parse(String(row.source_roots_json)) as string[],
    rules: JSON.parse(String(row.rules_json ?? '[]')) as RenameRule[],
    previewSummary: JSON.parse(String(row.preview_summary_json)) as PreviewSummary,
    canUndo: !row.undone_at,
    undoState: row.undone_at ? 'archived' : 'ready',
    undoReason: row.undone_at ? 'This batch was already undone.' : undefined,
  };
}

function toJournalRecord(row: Record<string, unknown>): JournalRecord {
  return {
    id: Number(row.id),
    createdAt: String(row.created_at),
    kind: String(row.kind) as JournalKind,
    status: String(row.status) as JournalStatus,
    entries: JSON.parse(String(row.entries_json)) as JournalEntry[],
    message: row.message ? String(row.message) : undefined,
  };
}

export interface OpenDatabaseResult {
  database: AppDatabase;
  /** Set when the previous database was corrupt and has been moved aside. */
  notice?: string;
}

/**
 * Opens the app database. Only a confirmed corrupt file (SQLITE_CORRUPT / SQLITE_NOTADB, or a
 * failed `PRAGMA quick_check`) is moved aside to `<name>.corrupt-<timestamp>` (with its
 * -wal/-shm/-journal files) and replaced by a fresh database. Every other failure leaves the file
 * untouched and throws: DatabaseVersionError for a database from a newer app version, and
 * DatabaseOpenError for locks, permissions, failed migrations and anything else, so the caller can
 * tell the user instead of silently discarding presets, history and recovery journals.
 */
export function openAppDatabase(
  databasePath = defaultDatabasePath(),
  options: AppDatabaseOptions = {},
): OpenDatabaseResult {
  try {
    return { database: new AppDatabase(databasePath, options) };
  } catch (error) {
    if (error instanceof DatabaseVersionError) {
      throw error;
    }
    if (!isDatabaseCorruptionError(error) || !fs.existsSync(databasePath)) {
      throw new DatabaseOpenError(databasePath, error);
    }
    const reason = error instanceof Error ? error.message : String(error);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${databasePath}.corrupt-${stamp}`;
    fs.renameSync(databasePath, backupPath);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      if (fs.existsSync(`${databasePath}${suffix}`)) {
        fs.renameSync(`${databasePath}${suffix}`, `${backupPath}${suffix}`);
      }
    }
    const notice =
      `The rename history database could not be opened because it is damaged (${reason}). It was moved to ${backupPath} ` +
      'and a new, empty database was created. Presets and history from the old file are not available.';
    console.error(`[db] ${notice}`);
    return { database: new AppDatabase(databasePath, options), notice };
  }
}
