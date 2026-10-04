import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from './db';
import { recoverInterruptedRenames } from './rename-journal';
import { runRenamePlan } from './rename-plan';
import type { RenameFsOps } from './rename-plan';

let tempRoot: string;
let database: AppDatabase;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-journal-'));
  await fs.mkdir(path.join(tempRoot, 'files'));
  database = new AppDatabase(path.join(tempRoot, 'db.sqlite'));
});

afterEach(async () => {
  database.close();
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function listTree(root: string): Promise<string[]> {
  const result: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      result.push(path.relative(root, full));
      if (entry.isDirectory()) {
        await walk(full);
      }
    }
  };
  await walk(root);
  return result.sort();
}

/** Simulates the process dying after `steps` renames: later renames (including rollback) all fail. */
function crashAfter(steps: number): Partial<RenameFsOps> {
  let calls = 0;
  return {
    rename: async (from, to) => {
      calls += 1;
      if (calls > steps) {
        throw new Error('simulated crash');
      }
      await fs.rename(from, to);
    },
  };
}

async function seedNested(files: string) {
  const dir = path.join(files, 'Album');
  await fs.mkdir(path.join(dir, 'inner'), { recursive: true });
  await fs.writeFile(path.join(dir, 'inner', 'Track 1.mp3'), '1');
  await fs.writeFile(path.join(dir, 'Track 2.mp3'), '2');
  await fs.writeFile(path.join(files, 'a.txt'), 'a');
  await fs.writeFile(path.join(files, 'b.txt'), 'b');
  return [
    { sourcePath: dir, targetPath: path.join(files, 'album'), isDirectory: true },
    {
      sourcePath: path.join(dir, 'inner', 'Track 1.mp3'),
      targetPath: path.join(dir, 'inner', 'track_1.mp3'),
      isDirectory: false,
    },
    { sourcePath: path.join(dir, 'Track 2.mp3'), targetPath: path.join(dir, 'track_2.mp3'), isDirectory: false },
    // swap
    { sourcePath: path.join(files, 'a.txt'), targetPath: path.join(files, 'b.txt'), isDirectory: false },
    { sourcePath: path.join(files, 'b.txt'), targetPath: path.join(files, 'a.txt'), isDirectory: false },
  ];
}

describe('recoverInterruptedRenames', () => {
  it('restores original names after a crash at any step, including nested folders and swaps', async () => {
    const files = path.join(tempRoot, 'files');
    const items = await seedNested(files);
    const before = await listTree(files);

    // 5 items => 10 renames. Crash after each possible number of completed steps.
    for (let steps = 1; steps < 10; steps += 1) {
      await expect(runRenamePlan('linux', items, { journal: database, fs: crashAfter(steps) })).rejects.toThrow(
        /simulated crash/,
      );
      expect(database.listUnfinishedJournals()).toHaveLength(1);

      const notices = await recoverInterruptedRenames('linux', database);
      expect(notices).toHaveLength(1);
      expect(notices[0].message).toMatch(/rolled back/);
      expect(await listTree(files)).toEqual(before);
      await expect(fs.readFile(path.join(files, 'a.txt'), 'utf8')).resolves.toBe('a');
      expect(database.listUnfinishedJournals()).toHaveLength(0);
    }
  });

  it('marks a journal completed when every item already reached its target', async () => {
    const files = path.join(tempRoot, 'files');
    const items = await seedNested(files);
    const result = await runRenamePlan('linux', items, { journal: database });
    // Pretend finalization never reached the database.
    database.finishJournal(result.journalId as number, 'in_progress');
    const after = await listTree(files);

    const notices = await recoverInterruptedRenames('linux', database);
    expect(notices[0].message).toMatch(/already finished/);
    expect(await listTree(files)).toEqual(after);
    expect(database.getJournal(result.journalId as number)?.status).toBe('completed');
  });

  it('reports items it cannot find without touching unrelated files', async () => {
    const files = path.join(tempRoot, 'files');
    await fs.writeFile(path.join(files, 'x.txt'), 'x');
    await fs.writeFile(path.join(files, 'y.txt'), 'y');
    await expect(
      runRenamePlan(
        'linux',
        [
          { sourcePath: path.join(files, 'x.txt'), targetPath: path.join(files, 'x2.txt'), isDirectory: false },
          { sourcePath: path.join(files, 'y.txt'), targetPath: path.join(files, 'y2.txt'), isDirectory: false },
        ],
        { journal: database, fs: crashAfter(2) },
      ),
    ).rejects.toThrow();
    // A user deletes one of the temp files before restarting.
    const temps = (await fs.readdir(files)).filter((name) => name.startsWith('.frtmp-'));
    expect(temps).toHaveLength(2);
    const survivor = await fs.readFile(path.join(files, temps[1]), 'utf8');
    await fs.rm(path.join(files, temps[0]));

    const notices = await recoverInterruptedRenames('linux', database);
    expect(notices[0].level).toBe('error');
    expect(notices[0].message).toMatch(/could not be located/);
    expect(await fs.readFile(path.join(files, `${survivor}.txt`), 'utf8')).toBe(survivor);
    expect(database.listUnfinishedJournals()).toHaveLength(0);
  });
});
