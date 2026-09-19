import type { UpdateState } from '@shared/contracts';
import type { useI18n } from '../i18n';

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

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / 1024 ** exponent;
  return `${scaled >= 10 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`;
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

export function getUpdateStatusLabel(status: UpdateState['status'], t: ReturnType<typeof useI18n>['t']) {
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

export function getUpdateSummary(state: UpdateState, t: ReturnType<typeof useI18n>['t']) {
  switch (state.status) {
    case 'disabled':
      return state.message ?? t('updates.summary.disabled');
    case 'checking':
      return t('updates.summary.checking');
    case 'available':
      return state.manualDownloadOnly
        ? state.message ?? t('updates.summary.available_manual', { version: state.availableVersion ?? 'unknown' })
        : t('updates.summary.available_auto', { version: state.availableVersion ?? 'unknown' });
    case 'downloading':
      return state.progress
        ? t('updates.summary.downloading_with_progress', {
            percent: state.progress.percent.toFixed(0),
            transferred: formatBytes(state.progress.transferred),
            total: formatBytes(state.progress.total),
          })
        : t('updates.summary.downloading');
    case 'downloaded':
      return t('updates.summary.downloaded', { version: state.availableVersion ?? 'unknown' });
    case 'up-to-date':
      return state.manualDownloadOnly
        ? t('updates.summary.up_to_date_manual')
        : t('updates.summary.up_to_date');
    case 'installing':
      return t('updates.summary.installing');
    case 'error':
      return state.message ?? t('updates.summary.error');
    default:
      return state.manualDownloadOnly
        ? state.message ?? t('updates.summary.idle_manual')
        : t('updates.summary.idle');
  }
}
