import { describe, expect, it } from 'vitest';
import { resolveNavigatorLocale, resolveStoredLocale } from './i18n-locale';

describe('resolveStoredLocale', () => {
  it('restores every supported locale from storage', () => {
    for (const locale of ['de', 'en', 'es', 'fr', 'it', 'pt-PT'] as const) {
      expect(resolveStoredLocale(locale)).toBe(locale);
    }
  });

  it('ignores unknown or empty stored values', () => {
    expect(resolveStoredLocale(null)).toBeNull();
    expect(resolveStoredLocale('')).toBeNull();
    expect(resolveStoredLocale('pt-BR')).toBeNull();
    expect(resolveStoredLocale('english')).toBeNull();
  });
});

describe('resolveNavigatorLocale', () => {
  it('maps browser languages to supported locales', () => {
    expect(resolveNavigatorLocale('de-DE')).toBe('de');
    expect(resolveNavigatorLocale('es-ES')).toBe('es');
    expect(resolveNavigatorLocale('fr-FR')).toBe('fr');
    expect(resolveNavigatorLocale('it-IT')).toBe('it');
    expect(resolveNavigatorLocale('pt-PT')).toBe('pt-PT');
    expect(resolveNavigatorLocale('pt-BR')).toBe('pt-PT');
    expect(resolveNavigatorLocale('en-US')).toBe('en');
    expect(resolveNavigatorLocale('ja-JP')).toBe('en');
  });
});
