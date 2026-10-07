import { describe, expect, it } from 'vitest';
import type { UpdateManualReason, UpdateState } from '@shared/contracts';
import { DEFAULT_LOCALE, LOCALE_REGISTRY, type MessageKey } from '../i18n';
import { createI18nRuntime, type TranslationVars } from '../i18n-core';
import { formatBytes, formatPercent, getUpdateSummary, versionOrUnknown } from './update-utils';

describe('update formatting', () => {
  it('formats percentages for the active locale', () => {
    expect(formatPercent(42.4, 'en')).toBe('42%');
    expect(formatPercent(42.4, 'fr').replace(/\s/g, ' ')).toBe('42 %');
    expect(formatPercent(150, 'en')).toBe('100%');
  });

  it('formats byte sizes with locale digits', () => {
    expect(formatBytes(1.5 * 1024 * 1024, 'en')).toBe('1.5 MB');
    expect(formatBytes(1.5 * 1024 * 1024, 'de')).toBe('1,5 MB');
    expect(formatBytes(0, 'en')).toBe('0 B');
  });

  it('falls back to a translated unknown version', () => {
    const t = (key: string) => `t:${key}`;
    expect(versionOrUnknown(undefined, t)).toBe('t:updates.version_unknown');
    expect(versionOrUnknown('1.2.3', t)).toBe('1.2.3');
  });
});

describe('getUpdateSummary', () => {
  const runtime = createI18nRuntime(LOCALE_REGISTRY, DEFAULT_LOCALE);
  const translatorFor = (locale: 'en' | 'pt-PT') => (key: MessageKey, vars?: TranslationVars) =>
    runtime.translate(locale, key, vars);
  const en = translatorFor('en');
  const pt = translatorFor('pt-PT');
  const base: UpdateState = { status: 'idle', currentVersion: '0.1.0', channel: 'stable' };
  const manual = (reason: UpdateManualReason, extra: Partial<UpdateState> = {}): UpdateState => ({
    ...base,
    manualDownloadOnly: true,
    reason,
    ...extra,
  });

  it.each([
    [
      'mac-signature-unverified',
      'Automatic updates are unavailable because this macOS build’s signature could not be verified. Download new versions manually from GitHub Releases.',
      'As atualizações automáticas não estão disponíveis porque não foi possível verificar a assinatura desta build para macOS. Transfira as novas versões manualmente das GitHub Releases.',
    ],
    [
      'mac-unsigned',
      'This macOS build is not Developer ID-signed, so updates must be downloaded manually from GitHub Releases.',
      'Esta build para macOS não está assinada com Developer ID, por isso as atualizações têm de ser transferidas manualmente das GitHub Releases.',
    ],
    [
      'windows-portable',
      'This Windows portable build can check for updates, but new versions must be downloaded manually from GitHub Releases.',
      'Esta build portátil para Windows procura atualizações, mas as novas versões têm de ser transferidas manualmente das GitHub Releases.',
    ],
  ] as const)('localizes the idle %s reason', (reason, enText, ptText) => {
    expect(getUpdateSummary(manual(reason), en, 'en')).toBe(enText);
    expect(getUpdateSummary(manual(reason), pt, 'pt-PT')).toBe(ptText);
  });

  it.each(['mac-signature-unverified', 'mac-unsigned', 'windows-portable'] as const)(
    'localizes manual available/up-to-date summaries for %s',
    (reason) => {
      const available = manual(reason, { status: 'available', availableVersion: '0.2.0' });
      expect(getUpdateSummary(available, en, 'en')).toBe('Version 0.2.0 is available to download from GitHub Releases.');
      expect(getUpdateSummary(available, pt, 'pt-PT')).toBe(
        'A versão 0.2.0 está disponível para transferência nas GitHub Releases.',
      );
      const upToDate = manual(reason, { status: 'up-to-date' });
      expect(getUpdateSummary(upToDate, pt, 'pt-PT')).toBe(pt('updates.summary.up_to_date_manual'));
    },
  );

  it('ignores a stale English message outside the error state', () => {
    const state = manual('mac-unsigned', {
      status: 'available',
      availableVersion: '0.2.0',
      message: 'Version 0.2.0 is available. Open GitHub to download the signed build manually.',
    });
    expect(getUpdateSummary(state, pt, 'pt-PT')).toBe(
      'A versão 0.2.0 está disponível para transferência nas GitHub Releases.',
    );
  });

  it('localizes the not-packaged disabled state', () => {
    const state: UpdateState = { ...base, status: 'disabled', reason: 'not-packaged' };
    expect(getUpdateSummary(state, pt, 'pt-PT')).toBe(pt('updates.summary.disabled'));
    expect(getUpdateSummary(state, en, 'en')).toBe('Install a packaged GitHub release to enable automatic updates.');
  });

  it('falls back to the generic manual summary when no reason is sent', () => {
    expect(getUpdateSummary({ ...base, manualDownloadOnly: true }, pt, 'pt-PT')).toBe(pt('updates.summary.idle_manual'));
  });

  it('shows free-form electron-updater errors verbatim, else a translated fallback', () => {
    const error: UpdateState = { ...base, status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' };
    expect(getUpdateSummary(error, pt, 'pt-PT')).toBe('net::ERR_INTERNET_DISCONNECTED');
    expect(getUpdateSummary({ ...base, status: 'error' }, pt, 'pt-PT')).toBe(pt('updates.summary.error'));
  });
});
