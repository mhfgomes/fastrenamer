import { describe, expect, it } from 'vitest';
import { createCustomTheme, THEME_PRESETS } from '../themes';
import { getThemeDescription, getThemeName } from './theme-labels';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

describe('theme labels', () => {
  it('translates preset names and descriptions', () => {
    expect(getThemeName(THEME_PRESETS[0], t)).toBe('theme.preset.dark.name');
    expect(getThemeDescription(THEME_PRESETS[1], t)).toBe('theme.preset.light.description');
  });

  it('describes custom themes by their source theme, even after a rename', () => {
    const custom = createCustomTheme(THEME_PRESETS[0], { name: 'Dark Copy', basedOnName: 'Dark' });
    const renamed = { ...custom, name: 'Night Shift' };
    expect(getThemeName(renamed, t)).toBe('Night Shift');
    expect(getThemeDescription(renamed, t)).toBe('theme.custom.based_on:{"name":"Dark"}');
  });

  it('uses localized fallbacks for empty custom names and descriptions', () => {
    const custom = { ...createCustomTheme(THEME_PRESETS[0], { name: '', basedOnName: '' }), basedOnName: undefined };
    expect(getThemeName(custom, t)).toBe('appearance.theme_name_placeholder');
    expect(getThemeDescription(custom, t)).toBe('theme.custom.fallback_description');
  });
});
