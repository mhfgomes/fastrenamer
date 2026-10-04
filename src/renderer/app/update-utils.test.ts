import { describe, expect, it } from 'vitest';
import { formatBytes, formatPercent, versionOrUnknown } from './update-utils';

describe('update formatting', () => {
  it('formats percentages for the active locale', () => {
    expect(formatPercent(42.4, 'en')).toBe('42%');
    expect(formatPercent(42.4, 'fr').replace(/\s/g, ' ')).toBe('42 %');
    expect(formatPercent(150, 'en')).toBe('100%');
  });

  it('formats byte sizes with locale digits', () => {
    expect(formatBytes(1.5 * 1024 * 1024, 'en')).toBe('1.5 MB');
    expect(formatBytes(1.5 * 1024 * 1024, 'de')).toBe('1,5 MB');
    expect(formatBytes(0, 'en')).toBe('0 B');
  });

  it('falls back to a translated unknown version', () => {
    const t = (key: string) => `t:${key}`;
    expect(versionOrUnknown(undefined, t)).toBe('t:updates.version_unknown');
    expect(versionOrUnknown('1.2.3', t)).toBe('1.2.3');
  });
});
