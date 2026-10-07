#!/usr/bin/env node
// Checks that every platform's release assets are present and complete before a
// release is published, then copies them into one upload folder.
//
// Usage:
//   node scripts/verify-release-assets.mjs --channel <latest|ea> --out <dir> \
//     macOS=<dir> Windows=<dir> Linux=<dir>
//
// actions/download-artifact does not fail when a pattern matches fewer artifacts
// than expected (for example after some have expired and only a failed job was
// re-run), so publishing must not trust whatever happened to be downloaded.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLATFORMS = ['macOS', 'Windows', 'Linux'];

const MANIFEST_SUFFIX = {
  macOS: '-mac.yml',
  Windows: '.yml',
  Linux: '-linux.yml',
};

// Installer kinds each platform must ship, matched by file name.
const REQUIRED_INSTALLERS = {
  macOS: [
    { label: 'DMG', test: (name) => name.endsWith('.dmg') },
    { label: 'ZIP', test: (name) => name.endsWith('.zip') },
  ],
  Windows: [
    { label: 'NSIS installer', test: (name) => /^Fast-Renamer-Setup-.*\.exe$/.test(name) },
    { label: 'portable executable', test: (name) => /^Fast-Renamer-Portable-.*\.exe$/.test(name) },
  ],
  Linux: [
    { label: 'AppImage', test: (name) => name.endsWith('.AppImage') },
    { label: 'deb package', test: (name) => name.endsWith('.deb') },
  ],
};

export function manifestName(platform, channel) {
  return `${channel}${MANIFEST_SUFFIX[platform]}`;
}

/** Returns the file names an electron-builder update manifest points at. */
export function parseManifestFiles(manifestText) {
  const referenced = new Set();
  for (const line of manifestText.split(/\r?\n/)) {
    const match = /^\s*(?:-\s+)?(?:url|path):\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line);
    if (match) {
      referenced.add(decodeURIComponent(match[1]));
    }
  }
  return [...referenced];
}

function listFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return null;
  }
  return readdirSync(dir).filter((name) => statSync(path.join(dir, name)).isFile());
}

/**
 * Validates one directory per platform. Returns a list of problems; an empty list
 * means every platform has its manifest, every file the manifest references, and
 * each required installer kind.
 */
export function verifyReleaseAssets({ channel, dirs }) {
  const problems = [];
  const seen = new Map();

  for (const platform of PLATFORMS) {
    const dir = dirs[platform];
    if (!dir) {
      problems.push(`${platform}: no asset directory given.`);
      continue;
    }

    const files = listFiles(dir);
    if (!files || files.length === 0) {
      problems.push(`${platform}: no release assets found in ${dir}.`);
      continue;
    }

    for (const name of files) {
      if (seen.has(name)) {
        problems.push(`${platform}: ${name} is also produced by ${seen.get(name)}.`);
      } else {
        seen.set(name, platform);
      }
      if (statSync(path.join(dir, name)).size === 0) {
        problems.push(`${platform}: ${name} is empty.`);
      }
    }

    const manifest = manifestName(platform, channel);
    if (!files.includes(manifest)) {
      problems.push(`${platform}: update manifest ${manifest} is missing.`);
    } else {
      const referenced = parseManifestFiles(readFileSync(path.join(dir, manifest), 'utf8'));
      if (referenced.length === 0) {
        problems.push(`${platform}: ${manifest} does not reference any files.`);
      }
      for (const name of referenced) {
        if (!files.includes(name)) {
          problems.push(`${platform}: ${manifest} references missing file ${name}.`);
        }
      }
    }

    for (const installer of REQUIRED_INSTALLERS[platform]) {
      if (!files.some(installer.test)) {
        problems.push(`${platform}: ${installer.label} is missing.`);
      }
    }
  }

  return problems;
}

export function collectReleaseAssets({ dirs, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const copied = [];
  for (const platform of PLATFORMS) {
    for (const name of listFiles(dirs[platform]) ?? []) {
      copyFileSync(path.join(dirs[platform], name), path.join(outDir, name));
      copied.push(name);
    }
  }
  return copied.sort();
}

function parseArgs(argv) {
  const options = { channel: undefined, outDir: undefined, dirs: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--channel') {
      options.channel = argv[++index];
    } else if (arg === '--out') {
      options.outDir = argv[++index];
    } else if (/^[^=]+=/.test(arg)) {
      const [platform, ...rest] = arg.split('=');
      options.dirs[platform] = rest.join('=');
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  if (options.channel !== 'latest' && options.channel !== 'ea') {
    throw new Error('--channel must be "latest" or "ea".');
  }
  if (!options.outDir) {
    throw new Error('--out is required.');
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const problems = verifyReleaseAssets(options);
    if (problems.length > 0) {
      console.error('Release assets are incomplete; refusing to publish:');
      for (const problem of problems) {
        console.error(`  - ${problem}`);
      }
      process.exit(1);
    }
    for (const name of collectReleaseAssets(options)) {
      console.log(name);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
