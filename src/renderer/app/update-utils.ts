import type { UpdateManualReason, UpdateState } from '@shared/contracts';
import type { Translate } from '../i18n';

type UpdateToastTone = 'default' | 'ok' | 'accent' | 'conflict';

export interface UpdateToastState {
  id: number;
  open: boolean;
  tone: UpdateToastTone;
  title: string;
  description: string;
  actionLabel?: string;
  actionKind?: 'open-settings' | 'install-update' | 'download-update';
}

/** Byte size with locale-aware digits, e.g. `1.5 MB` (en) or `1,5 MB` (de). */
export function formatBytes(value: number, locale?: string) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  if (!Number.isFinite(value) || value <= 0) {
    return `${new Intl.NumberFormat(locale).format(0)} ${units[0]}`;
  }

  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  const fractionDigits = scaled >= 10 || exponent === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(scaled);
  return `${number} ${units[exponent]}`;
}

/** Formats a 0–100 progress value as a locale-aware percentage, e.g. `42%` or `42 %`. */
export function formatPercent(percent: number, locale?: string) {
  const safe = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(safe / 100);
}

export function versionOrUnknown(version: string | null | undefined, t: Translate) {
  return version || t('updates.version_unknown');
}

export function getUpdateTone(status: UpdateState['status']) {
  switch (status) {
    case 'downloaded':
    case 'up-to-date':
      return 'ok';
    case 'available':
    case 'downloading':
    case 'checking':
    case 'installing':
      return 'accent';
    case 'error':
      return 'conflict';
    default:
      return 'default';
  }
}

export function getUpdateStatusLabel(status: UpdateState['status'], t: Translate) {
  switch (status) {
    case 'idle':
      return t('updates.status.idle');
    case 'disabled':
      return t('updates.status.disabled');
    case 'checking':
      return t('updates.status.checking');
    case 'available':
      return t('updates.status.available');
    case 'downloading':
      return t('updates.status.downloading');
    case 'downloaded':
      return t('updates.status.downloaded');
    case 'up-to-date':
      return t('updates.status.up_to_date');
    case 'installing':
      return t('updates.status.installing');
    case 'error':
      return t('updates.status.error');
  }
}

/** Localized explanation of why this build needs manual downloads (with GitHub Releases instructions). */
export function getManualUpdateReasonText(reason: UpdateManualReason, t: Translate) {
  switch (reason) {
    case 'mac-signature-unverified':
      return t('updates.manual_reason.mac_signature_unverified');
    case 'mac-unsigned':
      return t('updates.manual_reason.mac_unsigned');
    case 'windows-portable':
      return t('updates.manual_reason.windows_portable');
  }
}

/**
 * Translated status summary. `state.message` is only shown for `error`, where it carries free-form
 * text from electron-updater; every other state is rendered from its status and `reason` code.
 */
export function getUpdateSummary(state: UpdateState, t: Translate, locale?: string) {
  switch (state.status) {
    case 'disabled':
      return t('updates.summary.disabled');
    case 'checking':
      return t('updates.summary.checking');
    case 'available':
      return state.manualDownloadOnly
        ? t('updates.summary.available_manual', { version: versionOrUnknown(state.availableVersion, t) })
        : t('updates.summary.available_auto', { version: versionOrUnknown(state.availableVersion, t) });
    case 'downloading':
      return state.progress
        ? t('updates.summary.downloading_with_progress', {
            percent: formatPercent(state.progress.percent, locale),
            transferred: formatBytes(state.progress.transferred, locale),
            total: formatBytes(state.progress.total, locale),
          })
        : t('updates.summary.downloading');
    case 'downloaded':
      return t('updates.summary.downloaded', { version: versionOrUnknown(state.availableVersion, t) });
    case 'up-to-date':
      return state.manualDownloadOnly
        ? t('updates.summary.up_to_date_manual')
        : t('updates.summary.up_to_date');
    case 'installing':
      return t('updates.summary.installing');
    case 'error':
      return state.message ?? t('updates.summary.error');
    default:
      if (!state.manualDownloadOnly) {
        return t('updates.summary.idle');
      }
      return state.reason && state.reason !== 'not-packaged'
        ? getManualUpdateReasonText(state.reason, t)
        : t('updates.summary.idle_manual');
  }
}
