import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RenameExecutionError,
  RenamePlanError,
  TEMP_NAME_PREFIX,
  createTempName,
  runRenamePlan,
  validateTargetName,
} from './rename-plan';
import type { JournalEntry, JournalKind, JournalStatus, RenameJournalWriter } from './rename-plan';

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fast-renamer-plan-'));
});

afterEach(async () => {
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

class MemoryJournal implements RenameJournalWriter {
  journals: Array<{ id: number; kind: JournalKind; status: JournalStatus; entries: JournalEntry[]; message?: string }> = [];

  beginJournal(kind: JournalKind, entries: JournalEntry[]) {
    const id = this.journals.length + 1;
    this.journals.push({ id, kind, status: 'in_progress', entries });
    return id;
  }

  finishJournal(id: number, status: JournalStatus, message?: string) {
    const journal = this.journals.find((candidate) => candidate.id === id);
    if (journal) {
      journal.status = status;
      journal.message = message;
    }
  }
}

async function isCaseSensitive(dir: string) {
  const probe = path.join(dir, 'CaseProbe');
  await fs.writeFile(probe, '');
  try {
    await fs.access(path.join(dir, 'caseprobe'));
    return false;
  } catch {
    return true;
  } finally {
    await fs.rm(probe, { force: true });
  }
}

describe('runRenamePlan', () => {
  it('renames nested directories and files without losing child targets', async () => {
    const originalDir = path.join(tempRoot, 'Parent Folder');
    const originalFile = path.join(originalDir, 'Quarterly Report.txt');
    const renamedDir = path.join(tempRoot, 'parent_folder');
    const renamedFile = path.join(renamedDir, 'quarterly_report.txt');

    await fs.mkdir(originalDir, { recursive: true });
    await fs.writeFile(originalFile, 'report');

    await runRenamePlan('linux', [
      { sourcePath: originalDir, targetPath: renamedDir, isDirectory: true },
      { sourcePath: originalFile, targetPath: renamedFile, isDirectory: false },
    ]);

    await expect(fs.readFile(renamedFile, 'utf8')).resolves.toBe('report');
  });

  it("places a child planned under its parent's OLD path inside the renamed parent", async () => {
    const parent = path.join(tempRoot, 'Old Parent');
    const middle = path.join(parent, 'keep');
    const child = path.join(middle, 'Child.txt');
    await fs.mkdir(middle, { recursive: true });
    await fs.writeFile(child, 'child');

    const journal = new MemoryJournal();
    const result = await runRenamePlan(
      'linux',
      [
        // Child first and targeting the stale parent path, as the engine can emit for some sort modes.
        { sourcePath: child, targetPath: path.join(middle, 'child.txt'), isDirectory: false },
        { sourcePath: parent, targetPath: path.join(tempRoot, 'new_parent'), isDirectory: true },
      ],
      { journal },
    );

    expect(await listTree(tempRoot)).toEqual(['new_parent', 'new_parent/keep', 'new_parent/keep/child.txt']);
    expect(result.items.map((item) => item.targetPath)).toEqual([
      path.join(tempRoot, 'new_parent', 'keep', 'child.txt'),
      path.join(tempRoot, 'new_parent'),
    ]);
    expect(journal.journals[0].status).toBe('completed');
  });

  it('rejects an inconsistent plan before touching the disk', async () => {
    const file = path.join(tempRoot, 'a.txt');
    await fs.writeFile(file, 'a');
    await fs.mkdir(path.join(tempRoot, 'elsewhere'));

    await expect(
      runRenamePlan('linux', [
        { sourcePath: file, targetPath: path.join(tempRoot, 'elsewhere', 'b.txt'), isDirectory: false },
      ]),
    ).rejects.toBeInstanceOf(RenamePlanError);
    expect(await listTree(tempRoot)).toEqual(['a.txt', 'elsewhere']);
  });

  it('rejects two items resolving to the same final path', async () => {
    await fs.writeFile(path.join(tempRoot, 'a.txt'), 'a');
    await fs.writeFile(path.join(tempRoot, 'b.txt'), 'b');
    await expect(
      runRenamePlan('linux', [
        { sourcePath: path.join(tempRoot, 'a.txt'), targetPath: path.join(tempRoot, 'c.txt'), isDirectory: false },
        { sourcePath: path.join(tempRoot, 'b.txt'), targetPath: path.join(tempRoot, 'c.txt'), isDirectory: false },
      ]),
    ).rejects.toBeInstanceOf(RenamePlanError);
  });

  it('swaps two names through temp staging', async () => {
    const a = path.join(tempRoot, 'a.txt');
    const b = path.join(tempRoot, 'b.txt');
    await fs.writeFile(a, 'A');
    await fs.writeFile(b, 'B');
    await runRenamePlan('linux', [
      { sourcePath: a, targetPath: b, isDirectory: false },
      { sourcePath: b, targetPath: a, isDirectory: false },
    ]);
    await expect(fs.readFile(a, 'utf8')).resolves.toBe('B');
    await expect(fs.readFile(b, 'utf8')).resolves.toBe('A');
  });

  it('handles case-only file renames through the temp staging path', async () => {
    const originalFile = path.join(tempRoot, 'Sample.txt');
    const renamedFile = path.join(tempRoot, 'sample.txt');
    await fs.writeFile(originalFile, 'case only');

    await runRenamePlan('darwin', [{ sourcePath: originalFile, targetPath: renamedFile, isDirectory: false }]);

    await expect(fs.readFile(renamedFile, 'utf8')).resolves.toBe('case only');
    expect(await fs.readdir(tempRoot)).toEqual(['sample.txt']);
  });

  it('uses short temp names that do not embed the original name', () => {
    const name = createTempName();
    expect(name.startsWith(TEMP_NAME_PREFIX)).toBe(true);
    expect(name).toMatch(/^\.frtmp-[0-9a-f]{12}$/);
  });

  it('renames items whose names are near the 255 byte limit', async () => {
    const longName = `${'x'.repeat(250)}.txt`; // 254 bytes; the old temp-name scheme overflowed here
    const source = path.join(tempRoot, longName);
    await fs.writeFile(source, 'long');
    await runRenamePlan('linux', [
      { sourcePath: source, targetPath: path.join(tempRoot, `${'y'.repeat(250)}.txt`), isDirectory: false },
    ]);
    await expect(fs.readFile(path.join(tempRoot, `${'y'.repeat(250)}.txt`), 'utf8')).resolves.toBe('long');
  });

  it('refuses target names longer than 255 bytes (UTF-8) before touching the disk', async () => {
    const source = path.join(tempRoot, 'a.txt');
    await fs.writeFile(source, 'a');
    const tooLong = 'é'.repeat(128); // 256 bytes, 128 UTF-16 units
    await expect(
      runRenamePlan('linux', [{ sourcePath: source, targetPath: path.join(tempRoot, tooLong), isDirectory: false }]),
    ).rejects.toThrow(/255 bytes/);
    expect(await fs.readdir(tempRoot)).toEqual(['a.txt']);

    expect(validateTargetName(tooLong, 'win32')).toBeNull();
    expect(validateTargetName('é'.repeat(127), 'linux')).toBeNull();
    expect(validateTargetName('a'.repeat(256), 'win32')).toMatch(/255 characters/);
    expect(validateTargetName('a/b', 'linux')).not.toBeNull();
    expect(validateTargetName('a\\b', 'win32')).not.toBeNull();
  });

  it('refuses to overwrite an existing target outside the plan', async () => {
    const source = path.join(tempRoot, 'a.txt');
    const occupied = path.join(tempRoot, 'b.txt');
    await fs.writeFile(source, 'a');
    await fs.writeFile(occupied, 'precious');

    await expect(
      runRenamePlan('linux', [{ sourcePath: source, targetPath: occupied, isDirectory: false }]),
    ).rejects.toThrow(/already exists/);
    await expect(fs.readFile(occupied, 'utf8')).resolves.toBe('precious');
    await expect(fs.readFile(source, 'utf8')).resolves.toBe('a');
  });

  it('refuses to replace a dangling symlink at the target', async () => {
    const source = path.join(tempRoot, 'a.txt');
    const link = path.join(tempRoot, 'b.txt');
    await fs.writeFile(source, 'a');
    await fs.symlink(path.join(tempRoot, 'missing'), link);

    await expect(
      runRenamePlan('linux', [{ sourcePath: source, targetPath: link, isDirectory: false }]),
    ).rejects.toThrow(/already exists/);
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
  });

  it('aborts and rolls back when a target appears after preflight', async () => {
    const a = path.join(tempRoot, 'a.txt');
    const b = path.join(tempRoot, 'b.txt');
    const intruder = path.join(tempRoot, 'b-new.txt');
    await fs.writeFile(a, 'A');
    await fs.writeFile(b, 'B');

    const journal = new MemoryJournal();
    let renames = 0;
    const promise = runRenamePlan(
      'linux',
      [
        { sourcePath: a, targetPath: path.join(tempRoot, 'a-new.txt'), isDirectory: false },
        { sourcePath: b, targetPath: intruder, isDirectory: false },
      ],
      {
        journal,
        fs: {
          rename: async (from, to) => {
            renames += 1;
            if (renames === 2) {
              // Something else creates the second target after the plan was validated.
              await fs.writeFile(intruder, 'intruder');
            }
            await fs.rename(from, to);
          },
        },
      },
    );

    await expect(promise).rejects.toBeInstanceOf(RenameExecutionError);
    await expect(promise).rejects.toMatchObject({ rolledBack: true });
    expect(await listTree(tempRoot)).toEqual(['a.txt', 'b-new.txt', 'b.txt']);
    await expect(fs.readFile(intruder, 'utf8')).resolves.toBe('intruder');
    expect(journal.journals[0].status).toBe('rolled_back');
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a case-variant target that is a different file (case-sensitive volume)',
    async () => {
      if (!(await isCaseSensitive(tempRoot))) {
        return;
      }
      const lower = path.join(tempRoot, 'report.txt');
      const upper = path.join(tempRoot, 'REPORT.txt');
      await fs.writeFile(lower, 'lower');
      await fs.writeFile(upper, 'upper');
      // 'darwin' treats the names as the same key, but they are different files on this volume.
      await expect(
        runRenamePlan('darwin', [{ sourcePath: lower, targetPath: upper, isDirectory: false }]),
      ).rejects.toThrow();
      await expect(fs.readFile(upper, 'utf8')).resolves.toBe('upper');
      await expect(fs.readFile(lower, 'utf8')).resolves.toBe('lower');
    },
  );

  it('reverts every completed step when a rename fails mid-plan', async () => {
    const dir = path.join(tempRoot, 'Dir');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'one.txt'), '1');
    await fs.writeFile(path.join(dir, 'two.txt'), '2');
    const before = await listTree(tempRoot);

    for (let failAt = 1; failAt <= 6; failAt += 1) {
      let calls = 0;
      const journal = new MemoryJournal();
      await expect(
        runRenamePlan(
          'linux',
          [
            { sourcePath: dir, targetPath: path.join(tempRoot, 'dir'), isDirectory: true },
            { sourcePath: path.join(dir, 'one.txt'), targetPath: path.join(dir, 'ONE.txt'), isDirectory: false },
            { sourcePath: path.join(dir, 'two.txt'), targetPath: path.join(dir, 'TWO.txt'), isDirectory: false },
          ],
          {
            journal,
            fs: {
              rename: async (from, to) => {
                calls += 1;
                if (calls === failAt) {
                  throw Object.assign(new Error('simulated EIO'), { code: 'EIO' });
                }
                await fs.rename(from, to);
              },
            },
          },
        ),
      ).rejects.toThrow(/simulated EIO.*reverted/);
      expect(await listTree(tempRoot)).toEqual(before);
      expect(journal.journals[0].status).toBe('rolled_back');
    }
  });

  it('refuses when the source no longer matches the expected fingerprint', async () => {
    const file = path.join(tempRoot, 'a.txt');
    await fs.writeFile(file, 'a');
    const first = await runRenamePlan('linux', [
      { sourcePath: file, targetPath: path.join(tempRoot, 'b.txt'), isDirectory: false },
    ]);
    // Replace the renamed file with a different one.
    await fs.rm(path.join(tempRoot, 'b.txt'));
    await fs.writeFile(path.join(tempRoot, 'other.txt'), 'other');
    await fs.writeFile(path.join(tempRoot, 'b.txt'), 'imposter');

    await expect(
      runRenamePlan(
        'linux',
        [{ sourcePath: path.join(tempRoot, 'b.txt'), targetPath: file, isDirectory: false }],
        { expectedFingerprints: new Map([[path.join(tempRoot, 'b.txt'), first.items[0].fingerprint]]) },
      ),
    ).rejects.toThrow(/no longer the item/);
  });
});
