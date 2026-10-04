import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseManifestFiles, verifyReleaseAssets } from './verify-release-assets.mjs';

const SCRIPT = fileURLToPath(new URL('./verify-release-assets.mjs', import.meta.url));

function manifest(files) {
  return [
    'version: 0.1.2-ea.3',
    'files:',
    ...files.flatMap((name) => [`  - url: ${name}`, '    sha512: abc==', '    size: 10']),
    `path: ${files[0]}`,
    'sha512: abc==',
    "releaseDate: '2026-10-03T09:30:20.000Z'",
    '',
  ].join('\n');
}

// Mirrors the layout of the real v0.1.2-ea.3 release.
function eaAssets() {
  return {
    macOS: {
      'ea-mac.yml': manifest(['Fast-Renamer-0.1.2-ea.3-arm64.zip', 'Fast-Renamer-0.1.2-ea.3-arm64.dmg']),
      'Fast-Renamer-0.1.2-ea.3-arm64.dmg': 'dmg',
      'Fast-Renamer-0.1.2-ea.3-arm64.dmg.blockmap': 'map',
      'Fast-Renamer-0.1.2-ea.3-arm64.zip': 'zip',
      'Fast-Renamer-0.1.2-ea.3-arm64.zip.blockmap': 'map',
    },
    Windows: {
      'ea.yml': manifest(['Fast-Renamer-Setup-0.1.2-ea.3-x64.exe']),
      'Fast-Renamer-Setup-0.1.2-ea.3-x64.exe': 'exe',
      'Fast-Renamer-Setup-0.1.2-ea.3-x64.exe.blockmap': 'map',
      'Fast-Renamer-Portable-0.1.2-ea.3-x64.exe': 'exe',
    },
    Linux: {
      'ea-linux.yml': manifest(['Fast-Renamer-0.1.2-ea.3-x86_64.AppImage']),
      'Fast-Renamer-0.1.2-ea.3-x86_64.AppImage': 'appimage',
      'Fast-Renamer-0.1.2-ea.3-amd64.deb': 'deb',
    },
  };
}

let root;

function writeAssets(assets) {
  const dirs = {};
  for (const [platform, files] of Object.entries(assets)) {
    const dir = path.join(root, platform);
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, name), content);
    }
    dirs[platform] = dir;
  }
  return dirs;
}

function runCli(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

describe('verifyReleaseAssets', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'release-assets-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('accepts a complete set of assets for all three platforms', () => {
    const dirs = writeAssets(eaAssets());
    assert.deepEqual(verifyReleaseAssets({ channel: 'ea', dirs }), []);
  });

  it('rejects a re-run where only the Linux artifact was downloaded', () => {
    // macOS and Windows artifacts expired; re-running the failed Linux job
    // left only its assets, which must not be published on their own.
    const { Linux } = eaAssets();
    const dirs = writeAssets({ Linux });
    dirs.macOS = path.join(root, 'macOS');
    dirs.Windows = path.join(root, 'Windows');

    const problems = verifyReleaseAssets({ channel: 'ea', dirs });
    assert.ok(problems.some((problem) => problem.startsWith('macOS: no release assets')));
    assert.ok(problems.some((problem) => problem.startsWith('Windows: no release assets')));
    assert.ok(!problems.some((problem) => problem.startsWith('Linux:')));
  });

  it('rejects a platform whose update manifest is missing', () => {
    const assets = eaAssets();
    delete assets.Windows['ea.yml'];
    const dirs = writeAssets(assets);
    assert.deepEqual(verifyReleaseAssets({ channel: 'ea', dirs }), [
      'Windows: update manifest ea.yml is missing.',
    ]);
  });

  it('rejects a manifest that points at a file that was not uploaded', () => {
    const assets = eaAssets();
    delete assets.macOS['Fast-Renamer-0.1.2-ea.3-arm64.zip'];
    const dirs = writeAssets(assets);
    const problems = verifyReleaseAssets({ channel: 'ea', dirs });
    assert.ok(
      problems.includes('macOS: ea-mac.yml references missing file Fast-Renamer-0.1.2-ea.3-arm64.zip.'),
    );
    assert.ok(problems.includes('macOS: ZIP is missing.'));
  });

  it('rejects a missing installer that the manifest does not mention', () => {
    const assets = eaAssets();
    delete assets.Windows['Fast-Renamer-Portable-0.1.2-ea.3-x64.exe'];
    delete assets.Linux['Fast-Renamer-0.1.2-ea.3-amd64.deb'];
    const dirs = writeAssets(assets);
    assert.deepEqual(verifyReleaseAssets({ channel: 'ea', dirs }), [
      'Windows: portable executable is missing.',
      'Linux: deb package is missing.',
    ]);
  });

  it('checks the stable channel manifests separately from EA ones', () => {
    const dirs = writeAssets(eaAssets());
    const problems = verifyReleaseAssets({ channel: 'latest', dirs });
    assert.deepEqual(problems, [
      'macOS: update manifest latest-mac.yml is missing.',
      'Windows: update manifest latest.yml is missing.',
      'Linux: update manifest latest-linux.yml is missing.',
    ]);
  });

  it('rejects empty files', () => {
    const assets = eaAssets();
    assets.Linux['Fast-Renamer-0.1.2-ea.3-amd64.deb'] = '';
    const dirs = writeAssets(assets);
    assert.deepEqual(verifyReleaseAssets({ channel: 'ea', dirs }), [
      'Linux: Fast-Renamer-0.1.2-ea.3-amd64.deb is empty.',
    ]);
  });
});

describe('parseManifestFiles', () => {
  it('reads url and path entries from an electron-builder manifest', () => {
    assert.deepEqual(
      parseManifestFiles(manifest(['Fast-Renamer-0.1.1-arm64.zip', 'Fast-Renamer-0.1.1-arm64.dmg'])),
      ['Fast-Renamer-0.1.1-arm64.zip', 'Fast-Renamer-0.1.1-arm64.dmg'],
    );
  });
});

describe('verify-release-assets CLI', () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'release-assets-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('copies all assets into the output folder when complete', () => {
    const dirs = writeAssets(eaAssets());
    const out = path.join(root, 'out');
    const result = runCli([
      '--channel', 'ea', '--out', out,
      `macOS=${dirs.macOS}`, `Windows=${dirs.Windows}`, `Linux=${dirs.Linux}`,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const expected = Object.values(eaAssets()).flatMap((files) => Object.keys(files)).sort();
    assert.deepEqual(readdirSync(out).sort(), expected);
  });

  it('exits non-zero and copies nothing when a platform is missing', () => {
    const { Linux } = eaAssets();
    const dirs = writeAssets({ Linux });
    const out = path.join(root, 'out');
    const result = runCli([
      '--channel', 'ea', '--out', out,
      `macOS=${path.join(root, 'macOS')}`, `Windows=${path.join(root, 'Windows')}`, `Linux=${dirs.Linux}`,
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to publish/);
    assert.throws(() => readdirSync(out), { code: 'ENOENT' });
  });
});
