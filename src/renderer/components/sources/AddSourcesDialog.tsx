import { useMemo } from 'react';
import { FileInput, Trash2 } from 'lucide-react';
import type { SortMode, SourceMode } from '@fastrenamer/rename-engine/types';
import {
  Badge,
  Button,
  IconButton,
  Input,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui';
import { useI18n } from '../../i18n';
import { SORT_MODE_OPTIONS } from '../../constants';
import { getSortModeMeta, getSourceModeMeta } from '../../app/source-meta';
import type { AddSourcesDialogState } from '../../hooks/useSourceSelection';

export function AddSourcesDialog({ dialog }: { dialog: AddSourcesDialogState }) {
  const { t } = useI18n();
  const sourceModeMeta = useMemo(() => getSourceModeMeta(t), [t]);
  const sortModeMeta = useMemo(() => getSortModeMeta(t), [t]);

  return (
    <Modal
      open={dialog.open}
      onOpenChange={dialog.onOpenChange}
      title={dialog.isDrop ? t('sources.add.dropped_title') : t('sources.add.title')}
      description={dialog.isDrop ? t('sources.add.dropped_description') : t('sources.add.description')}
    >
      <div className="space-y-5 p-5">
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('sources.set')}
            </label>
            <Select
              value={dialog.draftSourceMode}
              onValueChange={(value) => dialog.onDraftSourceModeChange(value as SourceMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {dialog.availableModes.includes('picked_folders') && (
                  <SelectItem value="picked_folders">{sourceModeMeta.picked_folders.label}</SelectItem>
                )}
                {dialog.availableModes.includes('picked_files') && (
                  <SelectItem value="picked_files">{sourceModeMeta.picked_files.label}</SelectItem>
                )}
                {dialog.availableModes.includes('top_level_folders') && (
                  <SelectItem value="top_level_folders">{sourceModeMeta.top_level_folders.label}</SelectItem>
                )}
                {dialog.availableModes.includes('subfolders') && (
                  <SelectItem value="subfolders">{sourceModeMeta.subfolders.label}</SelectItem>
                )}
                {dialog.availableModes.includes('top_level_files') && (
                  <SelectItem value="top_level_files">{sourceModeMeta.top_level_files.label}</SelectItem>
                )}
                {dialog.availableModes.includes('files_recursive') && (
                  <SelectItem value="files_recursive">{sourceModeMeta.files_recursive.label}</SelectItem>
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{sourceModeMeta[dialog.draftSourceMode].detail}</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('sources.filter')}
            </label>
            <Input
              value={dialog.draftFileNamePattern}
              onChange={(e) => dialog.onDraftFileNamePatternChange(e.target.value)}
              placeholder={t('sources.filter.placeholder')}
              disabled={!sourceModeMeta[dialog.draftSourceMode].supportsFilter}
            />
            <p className="text-xs text-muted-foreground">
              {sourceModeMeta[dialog.draftSourceMode].supportsFilter
                ? t('sources.filter.help_supported')
                : t('sources.filter.help_unsupported')}
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('sources.sort')}
            </label>
            <Select
              value={dialog.draftSortMode}
              onValueChange={(value) => dialog.onDraftSortModeChange(value as SortMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_MODE_OPTIONS.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {sortModeMeta[mode].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('sources.sort.help')}</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-sm font-semibold text-foreground">
            {dialog.isDrop ? t('sources.dropped') : t('sources.current')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge dot tone="accent">{sourceModeMeta[dialog.draftSourceMode].label}</Badge>
            <Badge dot>{t('sources.sort.badge', { mode: sortModeMeta[dialog.draftSortMode].label })}</Badge>
            {dialog.draftFileNamePattern ? <Badge dot>{dialog.draftFileNamePattern}</Badge> : null}
            <Badge dot>{t('sources.roots', { count: dialog.rootCount })}</Badge>
          </div>
          {dialog.items.length > 0 && (
            <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
              {dialog.items.map((source) => (
                <div
                  key={source.path}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-card/70 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{source.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{source.path}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={source.isDirectory ? 'accent' : 'default'}>
                      {source.isDirectory ? t('sources.folder') : t('sources.file')}
                    </Badge>
                    <IconButton
                      className="h-7 w-7"
                      onClick={() => dialog.onRemoveSource(source.path)}
                      aria-label={t('sources.remove', { name: source.name })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => dialog.onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={dialog.onConfirm}>
            <FileInput className="h-3.5 w-3.5" />
            {dialog.isDrop ? t('sources.add.dropped_title') : sourceModeMeta[dialog.draftSourceMode].pickerLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
