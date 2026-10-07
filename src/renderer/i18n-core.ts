/**
 * Framework-free translation core used by `I18nProvider` (src/renderer/i18n.tsx).
 *
 * Message syntax:
 * - `{name}` placeholders are replaced with `vars.name` (left as-is when missing).
 * - Plurals: instead of a plain `key`, a dictionary may define `key.one`, `key.other`
 *   (and optionally `key.zero`, `key.two`, `key.few`, `key.many`). When `t(key, { count })`
 *   is called and `key` itself is not defined, the variant is chosen with
 *   `Intl.PluralRules` for the active locale, falling back to `key.other`.
 */

import { createLocaleResolver, type LocaleDescriptor, type LocaleResolver } from '@shared/i18n-locale';

export type TranslationDict = Readonly<Record<string, string>>;
export type TranslationVars = Record<string, unknown>;

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

const PLACEHOLDER_PATTERN = /\{(\w+)\}/g;

export function interpolate(template: string, vars?: TranslationVars) {
  if (!vars) {
    return template;
  }

  return template.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
}

/** Sorted, de-duplicated placeholder names used in a message. */
export function getPlaceholders(template: string): string[] {
  return [...new Set(Array.from(template.matchAll(PLACEHOLDER_PATTERN), (match) => match[1]))].sort();
}

/**
 * Strips a trailing plural category (`.one`, `.other`, ...) from a dictionary key,
 * returning the base key callers pass to `t()`, or `null` for non-plural keys.
 */
export function getPluralBaseKey(key: string): string | null {
  const dot = key.lastIndexOf('.');
  if (dot <= 0) {
    return null;
  }
  const suffix = key.slice(dot + 1);
  return (PLURAL_CATEGORIES as readonly string[]).includes(suffix) ? key.slice(0, dot) : null;
}

function toPluralCount(count: unknown): number | null {
  if (typeof count === 'number') {
    return Number.isFinite(count) ? count : null;
  }
  if (typeof count === 'string' && count.trim() !== '') {
    const parsed = Number(count);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export type Translate<L extends string> = (locale: L, key: string, vars?: TranslationVars) => string;

export function createTranslator<L extends string>(
  dictionaries: Readonly<Record<L, TranslationDict>>,
  defaultLocale: NoInfer<L>,
): Translate<L> {
  const pluralRules = new Map<L, Intl.PluralRules>();

  const getPluralRules = (locale: L) => {
    let rules = pluralRules.get(locale);
    if (!rules) {
      rules = new Intl.PluralRules(locale);
      pluralRules.set(locale, rules);
    }
    return rules;
  };

  const lookup = (locale: L, key: string, vars?: TranslationVars): string | undefined => {
    const dict = dictionaries[locale];
    if (!dict) {
      return undefined;
    }

    const direct = dict[key];
    if (direct !== undefined) {
      return direct;
    }

    const count = toPluralCount(vars?.count);
    if (count !== null) {
      const category = getPluralRules(locale).select(count);
      const variant = dict[`${key}.${category}`];
      if (variant !== undefined) {
        return variant;
      }
    }

    return dict[`${key}.other`];
  };

  return (locale, key, vars) => {
    const message = lookup(locale, key, vars) ?? (locale !== defaultLocale ? lookup(defaultLocale, key, vars) : undefined);
    return message === undefined ? key : interpolate(message, vars);
  };
}

export interface LocaleRegistryEntry<D extends TranslationDict = TranslationDict> extends LocaleDescriptor {
  dict: D;
}

export interface I18nRuntime<L extends string> extends LocaleResolver<L> {
  translate: Translate<L>;
  availableLocales: Array<{ code: L; label: string; nativeLabel: string }>;
}

/**
 * Derives everything the app needs from a locale registry: valid-locale checks,
 * navigator matching, the language picker list and the translate function.
 */
export function createI18nRuntime<L extends string>(
  registry: Readonly<Record<L, LocaleRegistryEntry>>,
  defaultLocale: NoInfer<L>,
): I18nRuntime<L> {
  const resolver = createLocaleResolver(registry, defaultLocale);
  const dictionaries = Object.fromEntries(resolver.locales.map((code) => [code, registry[code].dict])) as Record<L, TranslationDict>;

  return {
    ...resolver,
    translate: createTranslator(dictionaries, defaultLocale),
    availableLocales: resolver.locales.map((code) => ({
      code,
      label: registry[code].label,
      nativeLabel: registry[code].nativeLabel,
    })),
  };
}
