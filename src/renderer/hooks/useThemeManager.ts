import { useEffect, useMemo, useState } from 'react';
import {
  ACTIVE_THEME_STORAGE_KEY,
  CUSTOM_THEMES_STORAGE_KEY,
  DEFAULT_THEME_ID,
  getAllThemes,
  getThemeSnapshot,
  LEGACY_THEME_STORAGE_KEY,
  migrateLegacyThemeId,
  resolveTheme,
  THEME_SNAPSHOT_STORAGE_KEY,
  THEME_TOKEN_FIELDS,
  type AppTheme,
  type ThemeTokenKey,
  type ThemeTokens,
  createCustomTheme,
} from '../themes';

export const THEME_TOKEN_CSS_VARIABLES: Record<ThemeTokenKey, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  surface: '--surface',
  surfaceElevated: '--surface-elevated',
  border: '--border',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  ring: '--ring',
  statusOk: '--status-ok',
  statusConflict: '--status-conflict',
  statusInvalid: '--status-invalid',
  statusUnchanged: '--status-unchanged',
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseStoredThemeTokens(value: unknown): ThemeTokens | null {
  if (!isRecord(value)) {
    return null;
  }

  const tokens = {} as ThemeTokens;
  for (const field of THEME_TOKEN_FIELDS) {
    const tokenValue = value[field.key];
    if (typeof tokenValue !== 'string') {
      return null;
    }
    tokens[field.key] = tokenValue;
  }

  return tokens;
}

export function parseStoredCustomThemes() {
  try {
    const stored = localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((theme): AppTheme[] => {
      if (!isRecord(theme)) {
        return [];
      }

      const baseThemeId = theme.baseThemeId === 'light' || theme.baseThemeId === 'dark'
        ? theme.baseThemeId
        : theme.colorScheme === 'light' || theme.colorScheme === 'dark'
          ? theme.colorScheme
        : null;
      const tokens = parseStoredThemeTokens(theme.tokens);

      if (!baseThemeId || !tokens) {
        return [];
      }

      return [{
        id: typeof theme.id === 'string' && theme.id ? theme.id : `custom-${crypto.randomUUID()}`,
        name: typeof theme.name === 'string' && theme.name.trim() ? theme.name : 'Custom Theme',
        description: typeof theme.description === 'string' && theme.description.trim()
          ? theme.description
          : 'User-created theme.',
        baseThemeId,
        tokens,
        kind: 'custom',
      }];
    });
  } catch {
    return [];
  }
}

export function applyTheme(theme: AppTheme) {
  const root = document.documentElement;

  root.dataset.theme = theme.id;
  root.dataset.colorScheme = theme.baseThemeId;

  for (const field of THEME_TOKEN_FIELDS) {
    root.style.setProperty(THEME_TOKEN_CSS_VARIABLES[field.key], theme.tokens[field.key]);
  }
}

export function useThemeManager() {
  const [customThemes, setCustomThemes] = useState<AppTheme[]>(() => parseStoredCustomThemes());
  const [activeThemeId, setActiveThemeId] = useState(() => {
    const storedThemeId = localStorage.getItem(ACTIVE_THEME_STORAGE_KEY);
    if (storedThemeId) {
      return migrateLegacyThemeId(storedThemeId);
    }

    return migrateLegacyThemeId(localStorage.getItem(LEGACY_THEME_STORAGE_KEY));
  });

  const themes = useMemo(() => getAllThemes(customThemes), [customThemes]);
  const theme = useMemo(() => resolveTheme(activeThemeId, customThemes), [activeThemeId, customThemes]);

  useEffect(() => {
    if (!themes.some((candidate) => candidate.id === activeThemeId)) {
      setActiveThemeId(theme.id);
    }
  }, [activeThemeId, theme.id, themes]);

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(ACTIVE_THEME_STORAGE_KEY, theme.id);
    localStorage.setItem(THEME_SNAPSHOT_STORAGE_KEY, JSON.stringify(getThemeSnapshot(theme)));
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(customThemes));
  }, [customThemes]);

  function createThemeFrom(themeToClone: AppTheme) {
    const nextTheme = createCustomTheme(themeToClone);
    setCustomThemes((current) => [nextTheme, ...current]);
    setActiveThemeId(nextTheme.id);
  }

  return {
    theme,
    themes,
    setTheme: (themeId: string) => setActiveThemeId(migrateLegacyThemeId(themeId)),
    cycleTheme: () => {
      const currentIndex = themes.findIndex((candidate) => candidate.id === theme.id);
      const nextTheme = themes[(currentIndex + 1 + themes.length) % themes.length] ?? themes[0];
      if (nextTheme) {
        setActiveThemeId(nextTheme.id);
      }
    },
    createThemeFromActive: () => createThemeFrom(theme),
    createThemeFromId: (themeId: string) => {
      const sourceTheme = themes.find((candidate) => candidate.id === themeId);
      if (sourceTheme) {
        createThemeFrom(sourceTheme);
      }
    },
    renameCustomTheme: (themeId: string, name: string) => {
      setCustomThemes((current) =>
        current.map((candidate) =>
          candidate.id === themeId
            ? { ...candidate, name, description: `Custom theme based on ${name || 'your palette'}.` }
            : candidate,
        ),
      );
    },
    updateCustomThemeToken: (themeId: string, token: ThemeTokenKey, value: string) => {
      setCustomThemes((current) =>
        current.map((candidate) =>
          candidate.id === themeId
            ? { ...candidate, tokens: { ...candidate.tokens, [token]: value } }
            : candidate,
        ),
      );
    },
    deleteCustomTheme: (themeId: string) => {
      setCustomThemes((current) => current.filter((candidate) => candidate.id !== themeId));
      if (theme.id === themeId) {
        setActiveThemeId(DEFAULT_THEME_ID);
      }
    },
  };
}
