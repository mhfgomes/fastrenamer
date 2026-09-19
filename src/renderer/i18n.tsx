import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { en } from './locales/en';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { ptPT } from './locales/pt-PT';
import { DEFAULT_LOCALE, resolveNavigatorLocale, resolveStoredLocale, type AppLocale } from '@shared/i18n-locale';

export type { AppLocale } from '@shared/i18n-locale';
export { DEFAULT_LOCALE, resolveNavigatorLocale, resolveStoredLocale } from '@shared/i18n-locale';

type TranslationValue = string | ((vars?: Record<string, unknown>) => string);
type TranslationDict = Record<string, TranslationValue>;

const STORAGE_KEY = 'app_locale';

const TRANSLATIONS: Record<AppLocale, TranslationDict> = {
  de,
  en,
  es,
  fr,
  it,
  'pt-PT': ptPT,
};

const LOCALE_METADATA: Record<AppLocale, { label: string; nativeLabel: string }> = {
  de: { label: 'German', nativeLabel: 'Deutsch' },
  en: { label: 'English', nativeLabel: 'English' },
  es: { label: 'Spanish', nativeLabel: 'Espanol' },
  fr: { label: 'French', nativeLabel: 'Francais' },
  it: { label: 'Italian', nativeLabel: 'Italiano' },
  'pt-PT': { label: 'Portuguese (Portugal)', nativeLabel: 'Portugues (Portugal)' },
};

export const AVAILABLE_LOCALES: Array<{ code: AppLocale; label: string; nativeLabel: string }> = [
  { code: DEFAULT_LOCALE, ...LOCALE_METADATA[DEFAULT_LOCALE] },
  ...((Object.keys(TRANSLATIONS) as AppLocale[])
    .filter((locale) => locale !== DEFAULT_LOCALE)
    .map((code) => ({ code, ...LOCALE_METADATA[code] }))),
];

function interpolate(template: string, vars?: Record<string, unknown>) {
  if (!vars) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? `{${key}}` : String(value);
  });
}

function detectInitialLocale(): AppLocale {
  const stored = resolveStoredLocale(localStorage.getItem(STORAGE_KEY));
  if (stored) {
    return stored;
  }

  return resolveNavigatorLocale(navigator.language);
}

interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale>(detectInitialLocale);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale,
    t(key, vars) {
      const current = TRANSLATIONS[locale][key] ?? TRANSLATIONS.en[key];
      const fallback = TRANSLATIONS[DEFAULT_LOCALE][key];
      if (!current && !fallback) {
        return key;
      }

      const resolved = current ?? fallback;

      if (typeof resolved === 'function') {
        return resolved(vars);
      }

      return interpolate(resolved, vars);
    },
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within an I18nProvider.');
  }

  return value;
}
