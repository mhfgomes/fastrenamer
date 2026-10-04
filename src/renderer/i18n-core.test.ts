import { describe, expect, it } from 'vitest';
import {
  createI18nRuntime,
  createTranslator,
  getPlaceholders,
  getPluralBaseKey,
  interpolate,
  type LocaleRegistryEntry,
} from './i18n-core';

describe('interpolate', () => {
  it('replaces known placeholders and keeps unknown ones', () => {
    expect(interpolate('{count} of {total}', { count: 2 })).toBe('2 of {total}');
    expect(interpolate('name_{seq_num:0001}', { seq_num: 1 })).toBe('name_{seq_num:0001}');
    expect(interpolate('plain')).toBe('plain');
  });
});

describe('getPlaceholders / getPluralBaseKey', () => {
  it('extracts sorted unique placeholder names', () => {
    expect(getPlaceholders('{b} {a} {b} name_{seq_num:0001}')).toEqual(['a', 'b']);
  });

  it('recognises plural suffixes only', () => {
    expect(getPluralBaseKey('sources.roots.one')).toBe('sources.roots');
    expect(getPluralBaseKey('sources.roots.other')).toBe('sources.roots');
    expect(getPluralBaseKey('topbar.status.ok')).toBeNull();
    expect(getPluralBaseKey('other')).toBeNull();
  });
});

describe('createTranslator', () => {
  const translate = createTranslator(
    {
      en: {
        greeting: 'Hello {name}',
        'files.one': '{count} file',
        'files.other': '{count} files',
        only_en: 'English only',
      },
      fr: {
        greeting: 'Bonjour {name}',
        'files.one': '{count} fichier',
        'files.other': '{count} fichiers',
      },
      pl: {
        'files.one': '{count} plik',
        'files.few': '{count} pliki',
        'files.many': '{count} plików',
        'files.other': '{count} pliku',
      },
    },
    'en',
  );

  it('interpolates variables', () => {
    expect(translate('fr', 'greeting', { name: 'Ana' })).toBe('Bonjour Ana');
  });

  it('chooses plural variants with Intl.PluralRules for the active locale', () => {
    expect(translate('en', 'files', { count: 1 })).toBe('1 file');
    expect(translate('en', 'files', { count: 0 })).toBe('0 files');
    expect(translate('en', 'files', { count: 2 })).toBe('2 files');
    // French treats 0 as singular.
    expect(translate('fr', 'files', { count: 0 })).toBe('0 fichier');
    expect(translate('fr', 'files', { count: 3 })).toBe('3 fichiers');
    expect(translate('pl', 'files', { count: 3 })).toBe('3 pliki');
    expect(translate('pl', 'files', { count: 5 })).toBe('5 plików');
    expect(translate('pl', 'files', { count: 1.5 })).toBe('1.5 pliku');
  });

  it('accepts numeric strings and falls back to .other without a count', () => {
    expect(translate('en', 'files', { count: '1' })).toBe('1 file');
    expect(translate('en', 'files')).toBe('{count} files');
  });

  it('falls back to the default locale, then to the key itself', () => {
    expect(translate('fr', 'only_en')).toBe('English only');
    expect(translate('pl', 'greeting', { name: 'Ola' })).toBe('Hello Ola');
    expect(translate('fr', 'missing.key')).toBe('missing.key');
  });
});

describe('createI18nRuntime', () => {
  it('derives everything from the registry, so a new entry is all that is needed', () => {
    const registry = {
      en: { dict: { hello: 'Hello', 'items.one': '{count} item', 'items.other': '{count} items' }, label: 'English', nativeLabel: 'English', navigatorPrefixes: ['en'] },
      xx: { dict: { hello: 'Hullo', 'items.one': '{count} thing', 'items.other': '{count} things' }, label: 'Test', nativeLabel: 'Testish', navigatorPrefixes: ['xx', 'zz'] },
    } satisfies Record<string, LocaleRegistryEntry>;

    const runtime = createI18nRuntime(registry, 'en');

    expect(runtime.availableLocales).toEqual([
      { code: 'en', label: 'English', nativeLabel: 'English' },
      { code: 'xx', label: 'Test', nativeLabel: 'Testish' },
    ]);
    expect(runtime.resolveStoredLocale('xx')).toBe('xx');
    expect(runtime.resolveNavigatorLocale('zz-ZZ')).toBe('xx');
    expect(runtime.translate('xx', 'hello')).toBe('Hullo');
    expect(runtime.translate('xx', 'items', { count: 4 })).toBe('4 things');
  });
});
