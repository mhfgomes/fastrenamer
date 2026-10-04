/**
 * Pure, framework-free locale helpers.
 *
 * Nothing in here knows which locales exist. The renderer's locale registry
 * (`LOCALE_REGISTRY` in src/renderer/i18n.tsx) is the single source of truth and
 * feeds its entries into `createLocaleResolver`, which derives the valid-locale
 * set, stored-locale validation and navigator-language matching from it.
 */

export interface LocaleDescriptor {
  /** English name of the language, e.g. "German". */
  label: string;
  /** Name of the language in that language, e.g. "Deutsch". */
  nativeLabel: string;
  /**
   * BCP 47 language prefixes (case-insensitive) that should select this locale
   * when matched against `navigator.language`, e.g. `['pt']` matches `pt`, `pt-PT`
   * and `pt-BR`. The locale code itself always matches. When several locales
   * match, the longest (most specific) prefix wins.
   */
  navigatorPrefixes: readonly string[];
}

export interface LocaleResolver<L extends string> {
  readonly defaultLocale: L;
  /** Registered locale codes, default locale first, then registry order. */
  readonly locales: readonly L[];
  isLocale(value: unknown): value is L;
  resolveStoredLocale(stored: string | null | undefined): L | null;
  resolveNavigatorLocale(navigatorLanguage: string | readonly string[] | null | undefined): L;
}

function matchesPrefix(language: string, prefix: string) {
  return language === prefix || language.startsWith(`${prefix}-`);
}

export function createLocaleResolver<L extends string>(
  registry: Readonly<Record<L, LocaleDescriptor>>,
  defaultLocale: NoInfer<L>,
): LocaleResolver<L> {
  const codes = Object.keys(registry) as L[];
  if (!codes.includes(defaultLocale)) {
    throw new Error(`Default locale "${defaultLocale}" is not registered.`);
  }

  const locales: readonly L[] = [defaultLocale, ...codes.filter((code) => code !== defaultLocale)];
  const valid = new Set<string>(locales);

  const prefixes = locales
    .flatMap((code) =>
      [code, ...registry[code].navigatorPrefixes].map((prefix) => ({ code, prefix: prefix.toLowerCase() })),
    )
    .sort((a, b) => b.prefix.length - a.prefix.length);

  const matchLanguage = (language: string): L | null => {
    const normalized = language.trim().toLowerCase().replace(/_/g, '-');
    if (!normalized) {
      return null;
    }
    return prefixes.find(({ prefix }) => matchesPrefix(normalized, prefix))?.code ?? null;
  };

  return {
    defaultLocale,
    locales,
    isLocale(value): value is L {
      return typeof value === 'string' && valid.has(value);
    },
    resolveStoredLocale(stored) {
      return stored && valid.has(stored) ? (stored as L) : null;
    },
    resolveNavigatorLocale(navigatorLanguage) {
      const candidates = typeof navigatorLanguage === 'string' ? [navigatorLanguage] : navigatorLanguage ?? [];
      for (const candidate of candidates) {
        const match = matchLanguage(candidate);
        if (match) {
          return match;
        }
      }
      return defaultLocale;
    },
  };
}
