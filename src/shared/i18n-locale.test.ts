import { describe, expect, it } from 'vitest';
import { createLocaleResolver, type LocaleDescriptor } from './i18n-locale';

const registry = {
  en: { label: 'English', nativeLabel: 'English', navigatorPrefixes: ['en'] },
  pt: { label: 'Portuguese (Portugal)', nativeLabel: 'Português (Portugal)', navigatorPrefixes: ['pt'] },
  'pt-BR': { label: 'Portuguese (Brazil)', nativeLabel: 'Português (Brasil)', navigatorPrefixes: [] },
  nb: { label: 'Norwegian Bokmål', nativeLabel: 'Norsk bokmål', navigatorPrefixes: ['nb', 'no', 'nn'] },
} satisfies Record<string, LocaleDescriptor>;

describe('createLocaleResolver', () => {
  const resolver = createLocaleResolver(registry, 'en');

  it('lists the default locale first, then registry order', () => {
    expect(resolver.locales).toEqual(['en', 'pt', 'pt-BR', 'nb']);
  });

  it('accepts exactly the registered codes as stored locales', () => {
    for (const code of resolver.locales) {
      expect(resolver.resolveStoredLocale(code)).toBe(code);
      expect(resolver.isLocale(code)).toBe(true);
    }
    expect(resolver.resolveStoredLocale(null)).toBeNull();
    expect(resolver.resolveStoredLocale('')).toBeNull();
    expect(resolver.resolveStoredLocale('de')).toBeNull();
    expect(resolver.resolveStoredLocale('PT-br')).toBeNull();
    expect(resolver.isLocale(42)).toBe(false);
  });

  it('matches navigator languages by prefix, preferring the most specific match', () => {
    expect(resolver.resolveNavigatorLocale('pt-BR')).toBe('pt-BR');
    expect(resolver.resolveNavigatorLocale('pt_br')).toBe('pt-BR');
    expect(resolver.resolveNavigatorLocale('pt-PT')).toBe('pt');
    expect(resolver.resolveNavigatorLocale('pt')).toBe('pt');
    expect(resolver.resolveNavigatorLocale('no-NO')).toBe('nb');
    expect(resolver.resolveNavigatorLocale('nn')).toBe('nb');
    expect(resolver.resolveNavigatorLocale('en-GB')).toBe('en');
  });

  it('does not match partial language subtags', () => {
    // "ptx" is not a "pt" variant; "english" is not "en".
    expect(resolver.resolveNavigatorLocale('ptx')).toBe('en');
    expect(resolver.resolveNavigatorLocale('nbx-NO')).toBe('en');
  });

  it('walks a navigator.languages list and falls back to the default', () => {
    expect(resolver.resolveNavigatorLocale(['ja-JP', 'nb-NO', 'en-US'])).toBe('nb');
    expect(resolver.resolveNavigatorLocale(['ja-JP'])).toBe('en');
    expect(resolver.resolveNavigatorLocale([])).toBe('en');
    expect(resolver.resolveNavigatorLocale('')).toBe('en');
    expect(resolver.resolveNavigatorLocale(undefined)).toBe('en');
  });

  it('rejects a default locale that is not registered', () => {
    expect(() => createLocaleResolver(registry, 'de' as never)).toThrow(/not registered/);
  });
});
