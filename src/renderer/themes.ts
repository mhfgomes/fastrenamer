export type BaseThemeId = 'dark' | 'light';

export interface ThemeTokens {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  ring: string;
  statusOk: string;
  statusConflict: string;
  statusInvalid: string;
  statusUnchanged: string;
}

export interface AppTheme {
  id: string;
  name: string;
  description: string;
  baseThemeId: BaseThemeId;
  tokens: ThemeTokens;
  kind: 'preset' | 'custom';
}

export type ThemeTokenKey = keyof ThemeTokens;

export const LEGACY_THEME_STORAGE_KEY = 'theme';
export const ACTIVE_THEME_STORAGE_KEY = 'theme_active_id';
export const CUSTOM_THEMES_STORAGE_KEY = 'theme_custom_themes';
export const THEME_SNAPSHOT_STORAGE_KEY = 'theme_snapshot';

export const THEME_TOKEN_FIELDS: Array<{
  key: ThemeTokenKey;
  label: string;
  description: string;
}> = [
  { key: 'background', label: 'Background', description: 'Main app canvas.' },
  { key: 'foreground', label: 'Foreground', description: 'Primary body text.' },
  { key: 'card', label: 'Card', description: 'Panels and drawers.' },
  { key: 'cardForeground', label: 'Card Text', description: 'Text inside panels.' },
  { key: 'surface', label: 'Surface', description: 'Inputs and subtle fills.' },
  { key: 'surfaceElevated', label: 'Surface Elevated', description: 'Hover and lifted areas.' },
  { key: 'border', label: 'Border', description: 'Dividers and outlines.' },
  { key: 'muted', label: 'Muted', description: 'Soft background fills.' },
  { key: 'mutedForeground', label: 'Muted Text', description: 'Secondary labels and hints.' },
  { key: 'accent', label: 'Accent', description: 'Primary action color.' },
  { key: 'accentForeground', label: 'Accent Text', description: 'Text shown on accent surfaces.' },
  { key: 'destructive', label: 'Destructive', description: 'Danger actions and errors.' },
  { key: 'ring', label: 'Focus Ring', description: 'Keyboard focus highlight.' },
  { key: 'statusOk', label: 'Status OK', description: 'Success badges and indicators.' },
  { key: 'statusConflict', label: 'Status Conflict', description: 'Conflict badges and warnings.' },
  { key: 'statusInvalid', label: 'Status Invalid', description: 'Invalid state indicators.' },
  { key: 'statusUnchanged', label: 'Status Unchanged', description: 'Neutral unchanged state.' },
];

export const THEME_PRESETS: AppTheme[] = [
  {
    id: 'dark',
    name: 'Dark',
    description: 'The original deep-space default.',
    baseThemeId: 'dark',
    kind: 'preset',
    tokens: {
      background: '#080c14',
      foreground: '#e6ecf8',
      card: '#0d1322',
      cardForeground: '#e6ecf8',
      surface: '#121929',
      surfaceElevated: '#19223a',
      border: '#1c2840',
      muted: '#121929',
      mutedForeground: '#68739a',
      accent: '#4e8fff',
      accentForeground: '#080c14',
      destructive: '#f87171',
      ring: '#4e8fff',
      statusOk: '#34d399',
      statusConflict: '#f87171',
      statusInvalid: '#fb923c',
      statusUnchanged: '#64748b',
    },
  },
  {
    id: 'light',
    name: 'Light',
    description: 'The original bright workspace.',
    baseThemeId: 'light',
    kind: 'preset',
    tokens: {
      background: '#f5f7fc',
      foreground: '#0c1021',
      card: '#ffffff',
      cardForeground: '#0c1021',
      surface: '#edf0f8',
      surfaceElevated: '#ffffff',
      border: '#dde2ef',
      muted: '#edf0f8',
      mutedForeground: '#697290',
      accent: '#3762e0',
      accentForeground: '#ffffff',
      destructive: '#dc2626',
      ring: '#3762e0',
      statusOk: '#16a34a',
      statusConflict: '#dc2626',
      statusInvalid: '#ea580c',
      statusUnchanged: '#64748b',
    },
  },
];

export const DEFAULT_THEME_ID = THEME_PRESETS[0].id;

export function getPresetTheme(themeId: string) {
  return THEME_PRESETS.find((theme) => theme.id === themeId) ?? null;
}

export function getAllThemes(customThemes: AppTheme[]) {
  return [...THEME_PRESETS, ...customThemes];
}

export function resolveTheme(themeId: string | null, customThemes: AppTheme[]) {
  const requestedThemeId = migrateLegacyThemeId(themeId);
  return getAllThemes(customThemes).find((theme) => theme.id === requestedThemeId) ?? THEME_PRESETS[0];
}

export function migrateLegacyThemeId(themeId: string | null) {
  if (themeId === 'light') return 'light';
  if (themeId === 'dark') return 'dark';
  return themeId ?? DEFAULT_THEME_ID;
}

export function createCustomTheme(baseTheme: AppTheme, name?: string): AppTheme {
  return {
    ...baseTheme,
    id: `custom-${crypto.randomUUID()}`,
    name: name ?? `${baseTheme.name} Copy`,
    description: `Custom theme based on ${baseTheme.name}.`,
    kind: 'custom',
    tokens: { ...baseTheme.tokens },
  };
}

export function getThemeSnapshot(theme: AppTheme) {
  return {
    baseThemeId: theme.baseThemeId,
    tokens: theme.tokens,
  };
}
