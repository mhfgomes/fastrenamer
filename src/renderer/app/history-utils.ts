import type { HistoryEntry } from '@fast-renamer/rename-engine/types';
import type { useI18n } from '../i18n';

export function getUndoStatusLabel(entry: HistoryEntry, t: ReturnType<typeof useI18n>['t']) {
  switch (entry.undoState) {
    case 'ready':
      return t('undo.ready');
    case 'archived':
      return t('undo.archived');
    case 'overlap':
      return t('undo.overlap');
    case 'missing':
      return t('undo.missing');
    case 'occupied':
      return t('undo.occupied');
  }
}
