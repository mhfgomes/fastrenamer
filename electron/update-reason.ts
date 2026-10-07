import type { UpdateManualReason } from '../src/shared/contracts';

export interface ManualUpdateEnvironment {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  /** `PORTABLE_EXECUTABLE_FILE`, set by electron-builder's Windows portable launcher. */
  portableExecutableFile?: string;
  /** Runs `codesign -dv --verbose=4` on the app bundle (macOS only). */
  inspectCodeSignature: () => { status: number | null; output: string };
}

/**
 * Decides whether this build must download updates manually, and why. Returns a reason code
 * (translated by the renderer) or `undefined` when electron-updater can install in place.
 */
export function resolveManualUpdateReason(env: ManualUpdateEnvironment): UpdateManualReason | undefined {
  if (!env.isPackaged) {
    return undefined;
  }

  if (env.platform === 'darwin') {
    const { status, output } = env.inspectCodeSignature();
    if (status !== 0) {
      return 'mac-signature-unverified';
    }

    const hasDeveloperIdAuthority = output.includes('Authority=Developer ID Application:');
    const hasTeamIdentifier = !output.includes('TeamIdentifier=not set');
    const isAdHocSigned = output.includes('Signature=adhoc');
    return !hasDeveloperIdAuthority || !hasTeamIdentifier || isAdHocSigned ? 'mac-unsigned' : undefined;
  }

  if (env.platform === 'win32' && env.portableExecutableFile) {
    return 'windows-portable';
  }

  return undefined;
}
