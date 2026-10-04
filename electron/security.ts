import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Describes the only URL the renderer is allowed to load: the Vite dev server
 * origin in development, or the packaged `index.html` file in production.
 */
export type AppUrlPolicy =
  | { kind: 'dev-server'; origin: string }
  | { kind: 'file'; indexPath: string; platform: NodeJS.Platform };

export function createAppUrlPolicy(options: {
  devServerUrl?: string;
  indexPath: string;
  platform?: NodeJS.Platform;
}): AppUrlPolicy {
  if (options.devServerUrl) {
    return { kind: 'dev-server', origin: new URL(options.devServerUrl).origin };
  }

  return {
    kind: 'file',
    indexPath: path.resolve(options.indexPath),
    platform: options.platform ?? process.platform,
  };
}

function normalizeFilePath(pathname: string, platform: NodeJS.Platform) {
  const normalized = path.normalize(pathname);
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isAllowedAppUrl(rawUrl: string, policy: AppUrlPolicy): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (policy.kind === 'dev-server') {
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === policy.origin;
  }

  if (url.protocol !== 'file:' || (url.host !== '' && url.host !== 'localhost')) {
    return false;
  }

  let filePath: string;
  try {
    filePath = fileURLToPath(url);
  } catch {
    return false;
  }

  return (
    normalizeFilePath(filePath, policy.platform) ===
    normalizeFilePath(policy.indexPath, policy.platform)
  );
}

interface FrameIdentity {
  readonly url: string;
  readonly processId: number;
  readonly routingId: number;
}

/**
 * Minimal structural view of an IPC event so the check can be unit-tested
 * without an Electron runtime.
 */
export interface IpcSenderLike {
  readonly sender: unknown;
  readonly senderFrame: FrameIdentity | null;
}

export interface TrustedWindowLike {
  isDestroyed(): boolean;
  readonly webContents: {
    readonly mainFrame: FrameIdentity;
  };
}

/**
 * Accepts IPC only from the main window's top-level frame while it is showing
 * the app's own URL.
 */
export function isTrustedIpcSender(
  event: IpcSenderLike,
  trustedWindow: TrustedWindowLike | null,
  policy: AppUrlPolicy,
): boolean {
  if (!trustedWindow || trustedWindow.isDestroyed()) {
    return false;
  }

  const frame = event.senderFrame;
  if (!frame || event.sender !== trustedWindow.webContents) {
    return false;
  }

  const mainFrame = trustedWindow.webContents.mainFrame;
  if (frame.processId !== mainFrame.processId || frame.routingId !== mainFrame.routingId) {
    return false;
  }

  return isAllowedAppUrl(frame.url, policy);
}
