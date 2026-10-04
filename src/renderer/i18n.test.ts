import { describe, expect, it } from 'vitest';
import { AVAILABLE_LOCALES, DEFAULT_LOCALE, LOCALE_REGISTRY, resolveNavigatorLocale, resolveStoredLocale } from './i18n';
import { createI18nRuntime, getPlaceholders, getPluralBaseKey } from './i18n-core';
import { en, type LocaleDict } from './locales/en';

const locales = Object.keys(LOCALE_REGISTRY) as Array<keyof typeof LOCALE_REGISTRY>;
const enKeys = Object.keys(en).sort();

describe('locale registry', () => {
  it('exposes every registered locale in the picker, default first', () => {
    expect(AVAILABLE_LOCALES[0].code).toBe(DEFAULT_LOCALE);
    expect(AVAILABLE_LOCALES.map(({ code }) => code).sort()).toEqual([...locales].sort());
  });

  it('restores every registered locale from storage and ignores unknown values', () => {
    for (const locale of locales) {
      expect(resolveStoredLocale(locale)).toBe(locale);
    }
    expect(resolveStoredLocale(null)).toBeNull();
    expect(resolveStoredLocale('')).toBeNull();
    expect(resolveStoredLocale('pt-BR')).toBeNull();
    expect(resolveStoredLocale('english')).toBeNull();
  });

  it('maps browser languages to registered locales', () => {
    expect(resolveNavigatorLocale('de-DE')).toBe('de');
    expect(resolveNavigatorLocale('es-ES')).toBe('es');
    expect(resolveNavigatorLocale('fr-FR')).toBe('fr');
    expect(resolveNavigatorLocale('it-IT')).toBe('it');
    expect(resolveNavigatorLocale('pt-PT')).toBe('pt-PT');
    expect(resolveNavigatorLocale('pt-BR')).toBe('pt-PT');
    expect(resolveNavigatorLocale('en-US')).toBe('en');
    expect(resolveNavigatorLocale('ja-JP')).toBe('en');
  });

  it('picks up a newly registered locale without any other change', () => {
    const runtime = createI18nRuntime(
      {
        ...LOCALE_REGISTRY,
        'pt-BR': { dict: { ...LOCALE_REGISTRY['pt-PT'].dict, 'topbar.add': 'Adicionar (BR)' }, label: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)', navigatorPrefixes: ['pt-br'] },
      },
      DEFAULT_LOCALE,
    );

    expect(runtime.availableLocales.map(({ code }) => code)).toContain('pt-BR');
    expect(runtime.resolveStoredLocale('pt-BR')).toBe('pt-BR');
    expect(runtime.resolveNavigatorLocale('pt-BR')).toBe('pt-BR');
    expect(runtime.resolveNavigatorLocale('pt-PT')).toBe('pt-PT');
    expect(runtime.translate('pt-BR', 'topbar.add')).toBe('Adicionar (BR)');
  });
});

describe.each(locales)('locale %s', (locale) => {
  const dict: Readonly<Record<string, string>> = LOCALE_REGISTRY[locale].dict;

  it('defines exactly the en.ts key set (plus extra plural categories for plural keys)', () => {
    const extra = Object.keys(dict).filter((key) => !(key in en));
    const invalidExtra = extra.filter((key) => {
      const base = getPluralBaseKey(key);
      return base === null || !(`${base}.other` in en);
    });
    expect(invalidExtra).toEqual([]);
    expect(enKeys.filter((key) => !(key in dict))).toEqual([]);
  });

  it('uses the same placeholders as en.ts for every key', () => {
    const reference = (key: string) => {
      const base = getPluralBaseKey(key);
      return (key in en ? en[key as keyof typeof en] : en[`${base}.other` as keyof typeof en]) ?? '';
    };
    const mismatches = Object.keys(dict).filter(
      (key) => getPlaceholders(dict[key]).join(',') !== getPlaceholders(reference(key)).join(','),
    );
    expect(mismatches).toEqual([]);
  });

  it('has no empty messages', () => {
    expect(Object.entries(dict).filter(([, message]) => message.trim() === '').map(([key]) => key)).toEqual([]);
  });
});

describe('plural keys', () => {
  it('always define an .other variant next to any plural variant in en.ts', () => {
    const bases = new Set(enKeys.map(getPluralBaseKey).filter((base): base is string => base !== null));
    for (const base of bases) {
      expect(enKeys).toContain(`${base}.other`);
      expect(enKeys).not.toContain(base);
    }
  });

  it('renders singular and plural forms through t(key, { count })', () => {
    const { translate } = createI18nRuntime(LOCALE_REGISTRY, DEFAULT_LOCALE);
    expect(translate('en', 'sources.roots', { count: 1 })).toBe('1 picked root');
    expect(translate('en', 'sources.roots', { count: 3 })).toBe('3 picked roots');
    expect(translate('de', 'selected.files', { count: 1 })).toBe('1 Datei ausgewählt');
    expect(translate('pt-PT', 'selected.files', { count: 0 })).toBe('0 ficheiros selecionados');
    expect(translate('fr', 'selected.files', { count: 0 })).toBe('0 fichier sélectionné');
  });
});

describe('LocaleDict typing', () => {
  it('allows extra plural categories for plural keys only', () => {
    const extra: Partial<LocaleDict> = { 'sources.roots.few': '{count} roots', 'selected.files.many': '{count} files' };
    // @ts-expect-error -- non-plural keys cannot gain plural variants
    const invalid: Partial<LocaleDict> = { 'topbar.add.few': 'Add' };
    expect(Object.keys({ ...extra, ...invalid })).toHaveLength(3);
  });
});
