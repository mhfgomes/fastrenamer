import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { normalizePathKey } from '@fastrenamer/rename-engine';
import type { PlatformTarget, RenameBatchRecord } from '@fastrenamer/rename-engine';
import type { StartupNotice } from '../src/shared/contracts';
import {
  buildHierarchy,
  fingerprintFromStats,
  fingerprintsMatch,
  runRenamePlan,
} from './rename-plan';
import type { FileFingerprint, JournalEntry, JournalKind, JournalStatus, RenameJournalWriter } from './rename-plan';

export interface JournalRecord {
  id: number;
  createdAt: string;
  kind: JournalKind;
  status: JournalStatus;
  entries: JournalEntry[];
  message?: string;
}

export interface RenameJournalStore extends RenameJournalWriter {
  /** Journals left `in_progress` or `rollback_failed`, newest first. */
  listUnfinishedJournals(): JournalRecord[];
}

type ProbedState = 'source' | 'temp' | 'target' | 'lost';

async function matchesAt(candidate: string, fingerprint: FileFingerprint) {
  try {
    const stats = await fsp.lstat(candidate, { bigint: true });
    return fingerprintsMatch(fingerprint, fingerprintFromStats(stats));
  } catch {
    return false;
  }
}

/** Finds where each journaled item currently is (temp, target or source name). */
async function probeJournal(platform: PlatformTarget, entries: JournalEntry[]) {
  const nodes = buildHierarchy(
    platform,
    entries.map((entry) => entry.sourcePath),
  );
  const states: ProbedState[] = entries.map(() => 'lost');
  const currentPaths: Array<string | null> = entries.map(() => null);
  const order = entries.map((_entry, index) => index).sort((left, right) => nodes[left].depth - nodes[right].depth);

  for (const index of order) {
    const entry = entries[index];
    const node = nodes[index];
    let baseDir: string;
    if (node.parentIndex === -1) {
      baseDir = path.dirname(entry.sourcePath);
    } else {
      const parentPath = currentPaths[node.parentIndex];
      if (!parentPath) {
        continue;
      }
      baseDir = path.join(parentPath, ...node.segments);
    }

    const candidates: Array<[ProbedState, string]> = [
      ['temp', path.join(baseDir, entry.tempName)],
      ['target', path.join(baseDir, path.basename(entry.targetPath))],
      ['source', path.join(baseDir, path.basename(entry.sourcePath))],
    ];
    for (const [state, candidate] of candidates) {
      if (await matchesAt(candidate, entry.fingerprint)) {
        states[index] = state;
        currentPaths[index] = candidate;
        break;
      }
    }
  }

  return { states, currentPaths };
}

async function recoverJournal(
  platform: PlatformTarget,
  store: RenameJournalStore,
  journal: JournalRecord,
): Promise<StartupNotice> {
  const { states, currentPaths } = await probeJournal(platform, journal.entries);
  const label = `rename journal #${journal.id} (${journal.kind}, started ${journal.createdAt})`;

  if (states.every((state) => state === 'target')) {
    store.finishJournal(journal.id, 'completed', 'All items were found at their new names during recovery.');
    return {
      level: 'warning',
      message:
        `An interrupted ${label} had already finished: ${journal.entries.length} item(s) kept their new names. ` +
        'It may be missing from rename history.',
    };
  }

  const lost = journal.entries.filter((_entry, index) => states[index] === 'lost');
  const reverseItems: RenameBatchRecord[] = [];
  const expectedFingerprints = new Map<string, FileFingerprint>();
  journal.entries.forEach((entry, index) => {
    const currentPath = currentPaths[index];
    if (!currentPath || states[index] === 'source') {
      return;
    }
    reverseItems.push({
      sourcePath: currentPath,
      targetPath: path.join(path.dirname(currentPath), path.basename(entry.sourcePath)),
      isDirectory: entry.isDirectory,
    });
    expectedFingerprints.set(normalizePathKey(currentPath, platform), entry.fingerprint);
  });

  try {
    await runRenamePlan(platform, reverseItems, {
      journal: store,
      journalKind: 'recovery',
      expectedFingerprints,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    store.finishJournal(journal.id, 'recovery_failed', reason);
    return {
      level: 'error',
      message:
        `Fast Renamer could not restore the items of an interrupted ${label}: ${reason} ` +
        `Items may still have temporary names starting with ".frtmp-". Paths involved: ${describeEntries(journal.entries)}`,
    };
  }

  if (lost.length > 0) {
    const message = `${lost.length} item(s) could not be located: ${describeEntries(lost)}`;
    store.finishJournal(journal.id, 'recovery_failed', message);
    return {
      level: 'error',
      message:
        `An interrupted ${label} was partly restored (${reverseItems.length} item(s) moved back), but ${message}. ` +
        'Look for names starting with ".frtmp-" in those folders.',
    };
  }

  store.finishJournal(journal.id, 'recovered', `Restored ${reverseItems.length} item(s) to their original names.`);
  return {
    level: 'warning',
    message: `An interrupted ${label} was rolled back: ${reverseItems.length} item(s) were restored to their original names.`,
  };
}

function describeEntries(entries: JournalEntry[]) {
  const shown = entries.slice(0, 5).map((entry) => `${entry.sourcePath} (temp name ${entry.tempName})`);
  const more = entries.length > shown.length ? `, and ${entries.length - shown.length} more` : '';
  return `${shown.join(', ')}${more}`;
}

/**
 * Restores items of any rename that was interrupted (crash, power loss, kill) to their original
 * names. Journals are processed newest first, so an interrupted recovery is undone before the
 * rename it was recovering.
 */
export async function recoverInterruptedRenames(
  platform: PlatformTarget,
  store: RenameJournalStore,
): Promise<StartupNotice[]> {
  const notices: StartupNotice[] = [];
  // A recovery run journals itself; re-read after each journal so nested recoveries are seen once.
  const handled = new Set<number>();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const next = store.listUnfinishedJournals().find((journal) => !handled.has(journal.id));
    if (!next) {
      break;
    }
    handled.add(next.id);
    try {
      notices.push(await recoverJournal(platform, store, next));
    } catch (error) {
      notices.push({
        level: 'error',
        message: `Recovery of rename journal #${next.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  for (const notice of notices) {
    (notice.level === 'error' ? console.error : console.warn)(`[recovery] ${notice.message}`);
  }
  return notices;
}
