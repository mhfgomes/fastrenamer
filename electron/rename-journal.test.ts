import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase } from './db';
import { chooseProbedState, probeJournal, recoverInterruptedRenames } from './rename-journal';
import type { ProbeFs } from './rename-journal';
import { fingerprintFromStats, runRenamePlan } from './rename-plan';
import type { FileFingerprint, JournalEntry, RenameFsOps } from './rename-plan';

/** Whether the OS temp directory resolves names case-insensitively (default macOS/Windows volumes). */
function tempDirIsCaseInsensitive() {
  const dir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'fast-renamer-case-'));
  try {
    fsSync.writeFileSync(path.join(dir, 'CaseProbe'), '');
    return fsSync.existsSync(path.join(dir, 'caseprobe'));
  } finally {
    fsSync.rmSync(dir, { recursive: true, force: true });
  }
}
const caseInsensitiveTemp = tempDirIsCaseInsensitive();

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

describe('case-only renames during recovery', () => {
  const fingerprint: FileFingerprint = { dev: '1', ino: '7', size: '1', mtimeNs: '1', isDirectory: false };
  const entry: JournalEntry = {
    sourcePath: '/files/Foo.txt',
    targetPath: '/files/foo.txt',
    tempName: '.frtmp-000000000001',
    isDirectory: false,
    fingerprint,
  };

  /** A case-insensitive, case-preserving directory holding exactly `names`, all the same file. */
  function caseInsensitiveFs(names: string[]): ProbeFs {
    const keys = new Set(names.map((name) => path.join('/files', name).toLowerCase()));
    return {
      fingerprint: async (candidate) => (keys.has(candidate.toLowerCase()) ? fingerprint : null),
      listNames: async (directory) => (directory === '/files' ? names : null),
    };
  }

  it('treats an untouched case-only rename as still at its source name', async () => {
    const probed = await probeJournal('darwin', [entry], caseInsensitiveFs(['Foo.txt']));
    expect(probed).toEqual({ states: ['source'], currentPaths: ['/files/Foo.txt'] });
  });

  it('treats a finished case-only rename as at its target name', async () => {
    const probed = await probeJournal('darwin', [entry], caseInsensitiveFs(['foo.txt']));
    expect(probed).toEqual({ states: ['target'], currentPaths: ['/files/foo.txt'] });
  });

  it('finds an item at its temporary name', async () => {
    const probed = await probeJournal('darwin', [entry], caseInsensitiveFs([entry.tempName]));
    expect(probed.states).toEqual(['temp']);
  });

  it('falls back to identity alone when no candidate spelling is listed', () => {
    expect(
      chooseProbedState([
        { state: 'temp', identityMatches: false, spelledExactly: false },
        { state: 'target', identityMatches: true, spelledExactly: false },
        { state: 'source', identityMatches: true, spelledExactly: false },
      ]),
    ).toBe('target');
    expect(
      chooseProbedState([
        { state: 'target', identityMatches: false, spelledExactly: true },
        { state: 'source', identityMatches: false, spelledExactly: true },
      ]),
    ).toBe('lost');
  });

  it.skipIf(!caseInsensitiveTemp)(
    'leaves an untouched case-only rename alone on a real case-insensitive volume (skipped where the temp dir is case-sensitive)',
    async () => {
      const files = path.join(tempRoot, 'files');
      const source = path.join(files, 'Foo.txt');
      await fs.writeFile(source, 'foo');
      const journalId = database.beginJournal('execute', [
        {
          sourcePath: source,
          targetPath: path.join(files, 'foo.txt'),
          tempName: '.frtmp-000000000001',
          isDirectory: false,
          fingerprint: fingerprintFromStats(await fs.lstat(source, { bigint: true })),
        },
      ]);

      const notices = await recoverInterruptedRenames('darwin', database);
      expect(notices[0].message).not.toMatch(/already finished/);
      expect(database.getJournal(journalId)?.status).toBe('recovered');
      expect(await fs.readdir(files)).toEqual(['Foo.txt']);
    },
  );
});
