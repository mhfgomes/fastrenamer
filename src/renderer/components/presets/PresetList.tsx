import { Download } from 'lucide-react';
import type { Preset } from '@fast-renamer/rename-engine/types';
import { Badge, Button, EmptyState } from '../ui';
import { useI18n } from '../../i18n';

export function PresetList({
  presets,
  onLoad,
  onEdit,
  onExport,
  onDelete,
  emptyMessage,
}: {
  presets: Preset[];
  onLoad: (p: Preset) => void;
  onEdit: (p: Preset) => void;
  onExport?: (p: Preset) => void;
  onDelete?: (p: Preset) => void;
  emptyMessage: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {presets.length === 0 && <EmptyState message={emptyMessage} />}
      {presets.map((preset) => (
        <div key={preset.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{preset.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('presets.rules_count', { count: preset.rules.length })}</p>
            </div>
            <Badge tone={preset.isSample ? 'accent' : 'ok'} dot>
              {preset.isSample ? t('presets.sample') : t('presets.saved')}
            </Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onLoad(preset)}>{t('presets.load')}</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={preset.isSample}
              onClick={() => onEdit(preset)}
            >
              {t('presets.edit_name')}
            </Button>
            {onExport && !preset.isSample && (
              <Button size="sm" variant="ghost" onClick={() => onExport(preset)}>
                <Download className="h-3.5 w-3.5" />
                {t('presets.export')}
              </Button>
            )}
            {onDelete && !preset.isSample && (
              <Button size="sm" variant="danger" onClick={() => onDelete(preset)}>{t('common.delete')}</Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
