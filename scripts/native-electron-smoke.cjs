// Exercise the exact ABI used by the app, not just the Node test runner.
const { spawnSync } = require('node:child_process');
const electron = require('electron');
const addonPath = require('node:path').resolve(process.argv[2] || 'native/no-replace/build/Release/no_replace.node');
const result = spawnSync(electron, ['-e', `
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { renameNoReplace } = require(${JSON.stringify(addonPath)});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-native-electron-'));
  (async () => {
    try {
      // Hold the only libuv worker busy. A synchronous implementation would move
      // immediately; async_work must leave the source intact while JS keeps running.
      const assert = require('node:assert/strict');
      const source = path.join(root, 'queued-source');
      const destination = path.join(root, 'queued-destination');
      fs.writeFileSync(source, 'queued');
      const blocker = new Promise((resolve, reject) => {
        require('node:crypto').pbkdf2('password', 'salt', 1000000, 32, 'sha256', error => error ? reject(error) : resolve());
      });
      let settled = false;
      const pending = renameNoReplace(source, destination).then(() => { settled = true; });
      assert.ok(pending instanceof Promise);
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(settled, false);
      assert.ok(fs.existsSync(source), 'rename must execute in the worker pool');
      assert.equal(fs.existsSync(destination), false);
      await Promise.all([blocker, pending]);
      assert.equal(fs.readFileSync(destination, 'utf8'), 'queued');
      for (const directory of [false, true]) {
        const a = path.join(root, 'a-資料-é'), b = path.join(root, 'b-資料-é');
        if (directory) fs.mkdirSync(a); else fs.writeFileSync(a, 'original');
        await renameNoReplace(a, b);
        if (directory) fs.mkdirSync(a); else fs.writeFileSync(a, 'intruder');
        await require('node:assert').rejects(renameNoReplace(b, a), { code: 'EEXIST' });
        require('node:assert').ok(fs.existsSync(b));
        fs.rmSync(a, { recursive: true }); fs.rmSync(b, { recursive: true });
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', UV_THREADPOOL_SIZE: '1' }, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
