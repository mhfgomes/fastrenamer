import { Undo2 } from 'lucide-react';
import type { HistoryEntry, RenameRule } from '@fastrenamer/rename-engine/types';
import { Badge, Button, Drawer, EmptyState } from '../ui';
import { useI18n } from '../../i18n';
import { getUndoStatusLabel } from '../../app/history-utils';

export function HistoryDrawer({
  open,
  onOpenChange,
  history,
  mutating,
  onReuseRules,
  onUndo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: HistoryEntry[];
  /** A rename/undo is running: undo and rule reuse are blocked. */
  mutating: boolean;
  onReuseRules: (rules: RenameRule[]) => void;
  onUndo: (batchId: number) => void;
}) {
  const { locale, t } = useI18n();

  return (
    <Drawer open={open} onOpenChange={onOpenChange} title={t('history.title')} description={t('history.description')}>
      <div className="space-y-3 p-5">
        {history.length === 0 && <EmptyState message={t('history.empty')} />}
        {history.map((entry) => (
          <div key={entry.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">{t('history.batch', { id: entry.id })}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString(locale)}
                </p>
              </div>
              <Badge
                tone={
                  entry.undoState === 'ready'
                    ? 'ok'
                    : entry.undoState === 'archived'
                      ? 'unchanged'
                      : 'conflict'
                }
                dot
              >
                {getUndoStatusLabel(entry, t)}
              </Badge>
            </div>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span>{t('history.renamed', { count: entry.renamedCount })}</span>
              <span>{t('history.blocked', { count: entry.previewSummary.conflict + entry.previewSummary.invalid })}</span>
            </div>
            {entry.undoReason && entry.undoState !== 'ready' && entry.undoState !== 'archived' && (
              <p className="mt-3 text-xs text-conflict">{entry.undoReason}</p>
            )}
            {entry.rules.length === 0 && (
              <p className="mt-3 text-xs text-muted-foreground">{t('history.no_template')}</p>
            )}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={entry.rules.length === 0 || mutating}
                onClick={() => onReuseRules(entry.rules)}
              >
                {t('history.reuse')}
              </Button>
              <Button
                size="sm"
                disabled={!entry.canUndo || mutating}
                onClick={() => onUndo(entry.id)}
              >
                <Undo2 className="h-3.5 w-3.5" />
                {t('history.undo')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}
