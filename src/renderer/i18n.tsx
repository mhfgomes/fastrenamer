import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createI18nRuntime, type LocaleRegistryEntry, type TranslationVars } from './i18n-core';
import { en, type LocaleDict, type MessageKey } from './locales/en';
import { de } from './locales/de';
import { es } from './locales/es';
import { fr } from './locales/fr';
import { it } from './locales/it';
import { ptPT } from './locales/pt-PT';

/**
 * The one place to register a locale. Adding an entry here is all that is needed:
 * the `AppLocale` type, the language picker (`AVAILABLE_LOCALES`), stored-locale
 * validation and navigator-language detection are all derived from it.
 */
export const LOCALE_REGISTRY = {
  en: { dict: en, label: 'English', nativeLabel: 'English', navigatorPrefixes: ['en'] },
  de: { dict: de, label: 'German', nativeLabel: 'Deutsch', navigatorPrefixes: ['de'] },
  es: { dict: es, label: 'Spanish', nativeLabel: 'Español', navigatorPrefixes: ['es'] },
  fr: { dict: fr, label: 'French', nativeLabel: 'Français', navigatorPrefixes: ['fr'] },
  it: { dict: it, label: 'Italian', nativeLabel: 'Italiano', navigatorPrefixes: ['it'] },
  'pt-PT': { dict: ptPT, label: 'Portuguese (Portugal)', nativeLabel: 'Português (Portugal)', navigatorPrefixes: ['pt'] },
} as const satisfies Record<string, LocaleRegistryEntry<LocaleDict>>;

export type AppLocale = keyof typeof LOCALE_REGISTRY;

export const DEFAULT_LOCALE: AppLocale = 'en';

const runtime = createI18nRuntime<AppLocale>(LOCALE_REGISTRY, DEFAULT_LOCALE);
const translate = runtime.translate;

export const isAppLocale = runtime.isLocale;
export const resolveStoredLocale = runtime.resolveStoredLocale;
export const resolveNavigatorLocale = runtime.resolveNavigatorLocale;
export const AVAILABLE_LOCALES = runtime.availableLocales;

const STORAGE_KEY = 'app_locale';

function detectInitialLocale(): AppLocale {
  const stored = resolveStoredLocale(localStorage.getItem(STORAGE_KEY));
  if (stored) {
    return stored;
  }

  return resolveNavigatorLocale(navigator.languages?.length ? navigator.languages : navigator.language);
}

/**
 * Translator for UI rendered outside `I18nProvider` (the root error boundary). It uses the
 * persisted/detected locale, which is the provider's locale since every change is stored.
 */
export function getStandaloneTranslator() {
  let locale: AppLocale = DEFAULT_LOCALE;
  try {
    locale = detectInitialLocale();
  } catch {
    // Storage unavailable: fall back to the default locale.
  }
  return {
    locale,
    t: (key: MessageKey, vars?: TranslationVars) => translate(locale, key, vars),
  };
}

interface I18nContextValue {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  /**
   * Translates `key`, interpolating `{placeholders}` from `vars`. When `vars.count` is
   * given and the dictionary defines plural variants (`key.one`, `key.other`, ...),
   * the right form for the active locale is chosen automatically.
   */
  t: (key: MessageKey, vars?: TranslationVars) => string;
}

/** The `t()` function: only keys defined in `en.ts` (plural keys by their base name) type-check. */
export type Translate = I18nContextValue['t'];
export type { MessageKey };

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
    t: (key, vars) => translate(locale, key, vars),
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
