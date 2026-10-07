import { describe, expect, it } from 'vitest';
import { resolveManualUpdateReason, type ManualUpdateEnvironment } from './update-reason';

const DEVELOPER_ID_OUTPUT = [
  'Authority=Developer ID Application: Example (TEAM123456)',
  'TeamIdentifier=TEAM123456',
].join('\n');

function env(overrides: Partial<ManualUpdateEnvironment>): ManualUpdateEnvironment {
  return {
    platform: 'darwin',
    isPackaged: true,
    inspectCodeSignature: () => ({ status: 0, output: DEVELOPER_ID_OUTPUT }),
    ...overrides,
  };
}

describe('resolveManualUpdateReason', () => {
  it('never reports a manual reason for unpackaged runs', () => {
    const inspect = () => {
      throw new Error('codesign should not run');
    };
    expect(resolveManualUpdateReason(env({ isPackaged: false, inspectCodeSignature: inspect }))).toBeUndefined();
  });

  it('allows automatic updates for Developer ID-signed macOS builds', () => {
    expect(resolveManualUpdateReason(env({}))).toBeUndefined();
  });

  it('reports mac-signature-unverified when codesign fails', () => {
    expect(
      resolveManualUpdateReason(env({ inspectCodeSignature: () => ({ status: 1, output: 'code object is not signed at all' }) })),
    ).toBe('mac-signature-unverified');
    expect(resolveManualUpdateReason(env({ inspectCodeSignature: () => ({ status: null, output: '' }) }))).toBe(
      'mac-signature-unverified',
    );
  });

  it.each([
    ['ad-hoc signature', 'Signature=adhoc\nTeamIdentifier=not set'],
    ['missing team identifier', 'Authority=Developer ID Application: Example (X)\nTeamIdentifier=not set'],
    ['non-Developer ID authority', 'Authority=Apple Development: someone\nTeamIdentifier=TEAM123456'],
  ])('reports mac-unsigned for %s', (_label, output) => {
    expect(resolveManualUpdateReason(env({ inspectCodeSignature: () => ({ status: 0, output }) }))).toBe('mac-unsigned');
  });

  it('reports windows-portable only for the portable launcher', () => {
    expect(resolveManualUpdateReason(env({ platform: 'win32', portableExecutableFile: 'C:\\FastRenamer.exe' }))).toBe(
      'windows-portable',
    );
    expect(resolveManualUpdateReason(env({ platform: 'win32' }))).toBeUndefined();
  });

  it('keeps Linux on automatic updates', () => {
    expect(resolveManualUpdateReason(env({ platform: 'linux', portableExecutableFile: '/tmp/x' }))).toBeUndefined();
  });
});
