// Exercise the exact ABI used by the app, not just the Node test runner.
const { spawnSync } = require('node:child_process');
const electron = require('electron');
const result = spawnSync(electron, ['-e', `
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { renameNoReplace } = require(path.resolve('native/no-replace/build/Release/no_replace.node'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-native-electron-'));
  try {
    for (const directory of [false, true]) {
      const a = path.join(root, 'a'), b = path.join(root, 'b');
      if (directory) fs.mkdirSync(a); else fs.writeFileSync(a, 'original');
      renameNoReplace(a, b);
      if (directory) fs.mkdirSync(a); else fs.writeFileSync(a, 'intruder');
      require('node:assert').throws(() => renameNoReplace(b, a));
      require('node:assert').ok(fs.existsSync(b));
      fs.rmSync(a, { recursive: true }); fs.rmSync(b, { recursive: true });
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
