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
} from '@fast-renamer/rename-engine';
import type { PresetTransferEntry } from '../src/shared/contracts';

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

export class AppDatabase {
  private database: DatabaseSync;

  constructor(databasePath?: string) {
    const resolvedPath =
      databasePath ??
      path.join(app.getPath('userData'), 'fast-renamer.sqlite');
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    this.database = new DatabaseSync(resolvedPath);
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    this.seedSamplePresets();
  }

  private migrate() {
    const versionRow = this.database
      .prepare('PRAGMA user_version;')
      .get() as Record<string, unknown> | undefined;
    const version = Number(versionRow?.user_version ?? 0);

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
      this.database.exec('PRAGMA user_version = 2;');
    } else if (version < 2) {
      this.database.exec(`
        ALTER TABLE rename_batches ADD COLUMN rules_json TEXT NOT NULL DEFAULT '[]';
      `);
      this.database.exec('PRAGMA user_version = 2;');
    }
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

    for (const preset of SAMPLE_PRESETS) {
      if (existingNames.has(preset.name)) {
        continue;
      }
      insert.run(preset.name, JSON.stringify(preset.rules), now, now);
    }
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
    for (const preset of presets) {
      this.savePreset({
        name: preset.name.trim(),
        rules: preset.rules,
      });
    }

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
    items: RenameBatchRecord[];
  }) {
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
      `INSERT INTO rename_batch_items (batch_id, source_path, target_path, is_directory)
       VALUES (?, ?, ?, ?)`,
    );

    for (const item of input.items) {
      insertItem.run(batchId, item.sourcePath, item.targetPath, item.isDirectory ? 1 : 0);
    }

    this.pruneOldBatches();

    return batchId;
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
    for (const row of staleRows) {
      deleteBatch.run(Number(row.id));
    }
  }

  getBatchItems(batchId: number): RenameBatchRecord[] {
    const rows = this.database
      .prepare(
        `SELECT source_path, target_path, is_directory
         FROM rename_batch_items
         WHERE batch_id = ?
         ORDER BY LENGTH(source_path) DESC, source_path ASC`,
      )
      .all(batchId) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      sourcePath: String(row.source_path),
      targetPath: String(row.target_path),
      isDirectory: Boolean(row.is_directory),
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
         LIMIT 50`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: Number(row.id),
      createdAt: String(row.created_at),
      renamedCount: Number(row.renamed_count),
      sourceRoots: JSON.parse(String(row.source_roots_json)) as string[],
      rules: JSON.parse(String(row.rules_json ?? '[]')) as RenameRule[],
      previewSummary: JSON.parse(String(row.preview_summary_json)) as PreviewSummary,
      canUndo: !row.undone_at,
      undoState: row.undone_at ? 'archived' : 'ready',
      undoReason: row.undone_at ? 'This batch was already undone.' : undefined,
    }));
  }

  markBatchUndone(batchId: number) {
    this.database
      .prepare('UPDATE rename_batches SET undone_at = ? WHERE id = ?')
      .run(new Date().toISOString(), batchId);
  }
}
