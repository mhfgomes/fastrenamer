import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let binding: { renameNoReplace(from: string, to: string): void } | undefined;

/** Fails closed if the native addon, OS, or filesystem cannot provide exclusive rename. */
export async function renameNoReplace(from: string, to: string): Promise<void> {
  if (!binding) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    // Dev Electron also has resourcesPath; use app.isPackaged rather than its presence.
    const packaged = process.versions.electron && require('electron').app.isPackaged;
    const filename = packaged
      ? path.join(resourcesPath!, 'no_replace.node')
      : path.resolve(import.meta.dirname, '../native/no-replace/build/Release/no_replace.node');
    try {
      binding = require(filename);
    } catch (cause) {
      throw new Error('Atomic no-replace rename unavailable; build the native addon before renaming.', { cause });
    }
  }
  // Node-API is ABI stable across Node and Electron. This is a single metadata syscall.
  binding!.renameNoReplace(path.toNamespacedPath(from), path.toNamespacedPath(to));
}
