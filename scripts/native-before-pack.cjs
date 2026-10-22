const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('builder-util');
module.exports = async function beforePack(context) {
  // extraResources is a host-built binary. Reject cross-architecture packaging rather
  // than ship a package that cannot rename. Build each release on its target host.
  if (Arch[context.arch] !== process.arch || context.electronPlatformName !== process.platform) {
    throw new Error('Build the no-replace addon and Electron package on the target OS/architecture.');
  }
  const filename = path.join(context.packager.projectDir, 'native/no-replace/build/Release/no_replace.node');
  if (!fs.existsSync(filename)) throw new Error('Run bun run native:build before packaging.');
  require(filename);
};
