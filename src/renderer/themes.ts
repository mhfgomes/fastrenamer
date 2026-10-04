export type BaseThemeId = 'dark' | 'light';

/** Ids of the built-in themes; their names and descriptions are translated. */
export const PRESET_THEME_IDS = ['dark', 'light'] as const;
export type PresetThemeId = (typeof PRESET_THEME_IDS)[number];

export function isPresetThemeId(id: string): id is PresetThemeId {
  return (PRESET_THEME_IDS as readonly string[]).includes(id);
}

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
  /** Preset names are shown through i18n (`theme.preset.<id>.name`); custom names are user text. */
  name: string;
  /** Free-form description; empty for custom themes created by the app (see `basedOnName`). */
  description: string;
  /** Display name of the theme a custom theme was copied from, rendered via i18n. */
  basedOnName?: string;
  baseThemeId: BaseThemeId;
  tokens: ThemeTokens;
  kind: 'preset' | 'custom';
}

export type ThemeTokenKey = keyof ThemeTokens;

export const LEGACY_THEME_STORAGE_KEY = 'theme';
export const ACTIVE_THEME_STORAGE_KEY = 'theme_active_id';
export const CUSTOM_THEMES_STORAGE_KEY = 'theme_custom_themes';
export const THEME_SNAPSHOT_STORAGE_KEY = 'theme_snapshot';

/** Editable theme tokens, in display order. Labels live in i18n (`theme.token.<key>.label`). */
export const THEME_TOKEN_FIELDS: Array<{ key: ThemeTokenKey }> = [
  { key: 'background' },
  { key: 'foreground' },
  { key: 'card' },
  { key: 'cardForeground' },
  { key: 'surface' },
  { key: 'surfaceElevated' },
  { key: 'border' },
  { key: 'muted' },
  { key: 'mutedForeground' },
  { key: 'accent' },
  { key: 'accentForeground' },
  { key: 'destructive' },
  { key: 'ring' },
  { key: 'statusOk' },
  { key: 'statusConflict' },
  { key: 'statusInvalid' },
  { key: 'statusUnchanged' },
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

/**
 * Copies `baseTheme` into a new custom theme. Callers pass already-localized strings:
 * `name` for the copy and `basedOnName`, the display name of the source theme.
 */
export function createCustomTheme(
  baseTheme: AppTheme,
  { name, basedOnName }: { name: string; basedOnName: string },
): AppTheme {
  return {
    ...baseTheme,
    id: `custom-${crypto.randomUUID()}`,
    name,
    description: '',
    basedOnName,
    kind: 'custom',
    tokens: { ...baseTheme.tokens },
  };
}

/** Themes saved before descriptions were localized stored "Custom theme based on X." in English. */
const LEGACY_BASED_ON_DESCRIPTION = /^Custom theme based on (.+)\.$/;

export function parseLegacyBasedOnName(description: string) {
  return LEGACY_BASED_ON_DESCRIPTION.exec(description.trim())?.[1];
}

export function getThemeSnapshot(theme: AppTheme) {
  return {
    baseThemeId: theme.baseThemeId,
    tokens: theme.tokens,
  };
}
