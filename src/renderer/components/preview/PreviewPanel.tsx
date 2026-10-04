import { memo, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Badge, EmptyState, Panel, PanelHeader, cn } from '../ui';
import type { PreviewResult } from '@fastrenamer/rename-engine/types';
import { STATUS_OPTIONS, type StatusFilter } from '../../app/defaults';
import { useI18n } from '../../i18n';

const ESTIMATED_ROW_HEIGHT = 41;

/**
 * Memoized: only re-renders when the preview, the filters or the (stable) toggle callback change.
 * Rows are virtualized so folders with tens of thousands of items stay responsive.
 */
export const PreviewPanel = memo(function PreviewPanel({
  preview,
  statusFilters,
  onToggleFilter,
}: {
  preview: PreviewResult;
  statusFilters: StatusFilter[];
  onToggleFilter: (s: StatusFilter) => void;
}) {
  const { t } = useI18n();
  const rows = useMemo(
    () => preview.rows.filter((row) => statusFilters.includes(row.status)),
    [preview.rows, statusFilters],
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    getItemKey: (index) => rows[index].id,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;
  const statusCounts: Record<StatusFilter, number> = {
    ok: preview.summary.ok,
    conflict: preview.summary.conflict,
    invalid: preview.summary.invalid,
    unchanged: preview.summary.unchanged,
  };

  return (
    <Panel className="h-full">
      <PanelHeader
        title={t('preview.title')}
        detail={t('preview.detail')}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {STATUS_OPTIONS.filter((status) => statusCounts[status] > 0).map((status) => {
              const active = statusFilters.includes(status);
              const toneMap: Record<string, string> = {
                ok: 'text-ok border-ok/30 bg-ok/10',
                conflict: 'text-conflict border-conflict/30 bg-conflict/10',
                invalid: 'text-invalid border-invalid/30 bg-invalid/10',
                unchanged: 'text-unchanged border-unchanged/30 bg-unchanged/10',
              };
              return (
                <button
                  key={status}
                  onClick={() => onToggleFilter(status)}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-all duration-150',
                    active
                      ? toneMap[status]
                      : 'border-border bg-surface text-muted-foreground hover:border-border/80',
                  )}
                >
                  {status} {statusCounts[status]}
                </button>
              );
            })}
          </div>
        }
      />

      {preview.rows.length === 0 ? (
        <div className="p-4">
          <EmptyState message={t('preview.empty')} />
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
          {/* Fixed layout: with virtualization only visible rows exist, so auto layout would make
              column widths jump while scrolling. */}
          <table className="w-full min-w-[700px] table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col className="w-[120px]" />
              <col className="w-[34%]" />
              <col className="w-[34%]" />
              <col />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-border bg-card">
              <tr>
                {[t('preview.column.status'), t('preview.column.original'), t('preview.column.proposed'), t('preview.column.notes')].map((col) => (
                  <th
                    key={col}
                    className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paddingTop > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={4} style={{ height: paddingTop, padding: 0 }} />
                </tr>
              )}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                return (
                <tr
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className="border-b border-border/40 transition-colors hover:bg-surface/60"
                >
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Badge dot tone={row.status}>{row.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs break-all text-muted-foreground">
                    {row.originalName}
                  </td>
                  <td
                    className={cn(
                      'px-4 py-2.5 font-mono text-xs font-medium break-all',
                      row.status === 'ok' && 'text-ok',
                      row.status === 'conflict' && 'text-conflict',
                      row.status === 'invalid' && 'text-invalid',
                      row.status === 'unchanged' && 'text-muted-foreground',
                    )}
                  >
                    {row.proposedName}
                  </td>
                  <td
                    className="px-4 py-2.5 text-xs text-muted-foreground truncate"
                    title={row.reasons.length > 0 ? row.reasons.join(' ') : undefined}
                  >
                    {row.reasons.length > 0
                      ? row.reasons.join(' ')
                      : row.changed
                        ? t('preview.ready')
                        : t('preview.no_change')}
                  </td>
                </tr>
                );
              })}
              {paddingBottom > 0 && (
                <tr aria-hidden="true">
                  <td colSpan={4} style={{ height: paddingBottom, padding: 0 }} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
});
