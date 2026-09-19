export type AppLocale = 'de' | 'en' | 'es' | 'fr' | 'it' | 'pt-PT';

export const DEFAULT_LOCALE: AppLocale = 'en';

const VALID_LOCALES = new Set<AppLocale>(['de', 'en', 'es', 'fr', 'it', 'pt-PT']);

export function resolveStoredLocale(stored: string | null): AppLocale | null {
  if (stored && VALID_LOCALES.has(stored as AppLocale)) {
    return stored as AppLocale;
  }

  return null;
}

export function resolveNavigatorLocale(navigatorLanguage: string): AppLocale {
  const normalized = navigatorLanguage.toLowerCase();
  if (normalized.startsWith('de')) {
    return 'de';
  }
  if (normalized.startsWith('es')) {
    return 'es';
  }
  if (normalized.startsWith('fr')) {
    return 'fr';
  }
  if (normalized.startsWith('it')) {
    return 'it';
  }
  if (normalized.startsWith('pt')) {
    return 'pt-PT';
  }

  return DEFAULT_LOCALE;
}
