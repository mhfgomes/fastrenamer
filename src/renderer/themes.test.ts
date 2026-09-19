import { describe, expect, it } from 'vitest';
import {
  createCustomTheme,
  getThemeSnapshot,
  migrateLegacyThemeId,
  resolveTheme,
  THEME_PRESETS,
} from './themes';

describe('theme helpers', () => {
  it('provides only the dark and light built-in themes', () => {
    expect(THEME_PRESETS.map((theme) => theme.id)).toEqual(['dark', 'light']);
  });

  it('migrates legacy theme ids to current preset ids', () => {
    expect(migrateLegacyThemeId('light')).toBe('light');
    expect(migrateLegacyThemeId('dark')).toBe('dark');
    expect(migrateLegacyThemeId(null)).toBe(THEME_PRESETS[0].id);
    expect(migrateLegacyThemeId('custom-123')).toBe('custom-123');
  });

  it('resolves custom themes and falls back to the default preset', () => {
    const customTheme = createCustomTheme(THEME_PRESETS[0], 'Night Shift');
    expect(resolveTheme(customTheme.id, [customTheme]).id).toBe(customTheme.id);
    expect(resolveTheme('missing-theme', []).id).toBe(THEME_PRESETS[0].id);
  });

  it('creates theme snapshots for persistence', () => {
    const lightTheme = THEME_PRESETS.find((theme) => theme.id === 'light');
    expect(lightTheme).toBeDefined();
    const snapshot = getThemeSnapshot(lightTheme!);
    expect(snapshot.baseThemeId).toBe('light');
    expect(snapshot.tokens.background).toBe(lightTheme!.tokens.background);
  });
});
