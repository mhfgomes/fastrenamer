#!/usr/bin/env node
// Computes the Early Access version for a CI run.
//
// A prerelease sorts below its release (0.1.2-ea.1 < 0.1.2), so EA builds must
// be prereleases of a version that has not shipped as stable yet:
//
//   base = max(package.json version, highest stable vX.Y.Z tag)
//   if base has already shipped as stable, bump its patch component
//   ea_version = base-ea.<run number>
//
// Usage: node scripts/ea-version.mjs <run-number> [tags-file]
//   Reads package.json from the current directory. Tags are read from
//   tags-file (one ref or tag name per line, e.g. `refs/tags/v0.1.2`) or, when
//   omitted, from `git ls-remote --tags origin`. Prints the EA version.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const STABLE_TAG_REF = /^refs\/tags\/v(\d+\.\d+\.\d+)$/;

export function parseStableVersion(version) {
  const match = STABLE_VERSION.exec(version);
  if (!match) {
    return undefined;
  }
  return match.slice(1, 4).map(Number);
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/** Extracts stable versions (X.Y.Z) from `git ls-remote --tags` output or plain tag names. */
export function parseStableTags(lines) {
  const versions = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    // Accept "<sha>\trefs/tags/vX.Y.Z", "refs/tags/vX.Y.Z" or "vX.Y.Z".
    const ref = line.split(/\s+/).pop();
    const normalized = ref.startsWith('refs/tags/') ? ref : `refs/tags/${ref}`;
    const match = STABLE_TAG_REF.exec(normalized);
    if (match) {
      versions.push(match[1]);
    }
  }
  return versions;
}

export function computeEaVersion(packageVersion, stableTagVersions, runNumber) {
  const pkg = parseStableVersion(packageVersion);
  if (!pkg) {
    throw new Error(`package.json version must be X.Y.Z, got "${packageVersion}"`);
  }
  if (!/^\d+$/.test(String(runNumber))) {
    throw new Error(`run number must be a non-negative integer, got "${runNumber}"`);
  }

  const stable = stableTagVersions.map((version) => {
    const parsed = parseStableVersion(version);
    if (!parsed) {
      throw new Error(`invalid stable tag version "${version}"`);
    }
    return parsed;
  });

  const highestStable = stable.reduce(
    (highest, version) => (highest && compareVersions(highest, version) >= 0 ? highest : version),
    undefined,
  );

  let base = pkg;
  if (highestStable && compareVersions(highestStable, base) >= 0) {
    // The package version (or something newer) has already shipped as
    // stable: EA builds are prereleases of the next patch after it.
    base = [highestStable[0], highestStable[1], highestStable[2] + 1];
  }

  return `${base.join('.')}-ea.${runNumber}`;
}

function main() {
  const runNumber = process.argv[2] ?? process.env.GITHUB_RUN_NUMBER;
  if (!runNumber) {
    throw new Error('usage: node scripts/ea-version.mjs <run-number>');
  }

  const tagsFile = process.argv[3];
  const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const rawTags = tagsFile
    ? readFileSync(tagsFile, 'utf8')
    : execFileSync('git', ['ls-remote', '--tags', 'origin'], { encoding: 'utf8' });
  const tags = parseStableTags(rawTags.split('\n'));

  process.stdout.write(`${computeEaVersion(packageVersion, tags, runNumber)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
