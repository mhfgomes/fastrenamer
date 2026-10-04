import {
  CheckCircle2,
  Clock3,
  Copy,
  FileCode,
  FileInput,
  Minus,
  Palette,
  RefreshCcw,
  Save,
  Settings2,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useId } from 'react';
import type { PlatformTarget, PreviewResult, SortMode } from '@fastrenamer/rename-engine';
import type { WindowState } from '@shared/contracts';
import { APP_VERSION, SORT_MODE_OPTIONS } from '../constants';
import type { useI18n } from '../i18n';
import type { AppTheme } from '../themes';
import { getThemeName } from '../app/theme-labels';
import {
  Badge,
  Button,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  cn,
} from './ui';

export interface TopBarProps {
  platform: PlatformTarget;
  theme: AppTheme;
  themes: AppTheme[];
  windowState: WindowState;
  sourceCount: number;
  selectedLabel: string;
  sortMode: SortMode;
  sortModeMeta: Record<SortMode, { label: string }>;
  preview: PreviewResult;
  previewLoading: boolean;
  mutation: 'idle' | 'execute' | 'undo';
  /** Rename runs only for a current, unblocked preview (see usePreviewSession). */
  renameDisabled: boolean;
  /** Error from the last action (rename, undo, picker, presets...). */
  error: string | null;
  /** Error from the last preview generation, kept separate so neither erases the other. */
  previewError: string | null;
  /** Folders skipped while building the preview because they could not be read. */
  skippedDirectories: number;
  undoDisabled: boolean;
  t: ReturnType<typeof useI18n>['t'];
  onOpenAddSources: () => void;
  onClearSources: () => void;
  onRefresh: () => void;
  onExecute: () => void;
  onUndo: () => void;
  onOpenPresets: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onSelectTheme: (themeId: string) => void;
  onChangeSortMode: (mode: SortMode) => void;
  onMinimizeWindow: () => void;
  onToggleMaximizeWindow: () => void;
  onCloseWindow: () => void;
}

export function TopBar({
  platform,
  theme,
  themes,
  windowState,
  sourceCount,
  selectedLabel,
  sortMode,
  sortModeMeta,
  preview,
  previewLoading,
  mutation,
  renameDisabled,
  error,
  previewError,
  skippedDirectories,
  undoDisabled,
  t,
  onOpenAddSources,
  onClearSources,
  onRefresh,
  onExecute,
  onUndo,
  onOpenPresets,
  onOpenHistory,
  onOpenSettings,
  onSelectTheme,
  onChangeSortMode,
  onMinimizeWindow,
  onToggleMaximizeWindow,
  onCloseWindow,
}: TopBarProps) {
  const isMac = platform === 'darwin';
  const sortLabelId = useId();
  const mutating = mutation !== 'idle';
  const topBarGhostButtonClassName =
    'border border-transparent hover:border-accent/30 hover:bg-surface-elevated hover:text-foreground';

  return (
    <Panel className="overflow-visible">
      <div className="app-drag flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:px-5">
        <div className={cn('mr-1 flex items-center gap-2.5', isMac && 'pl-16 sm:pl-18')}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <FileCode className="h-4 w-4" />
          </div>
          <div className="leading-none">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Fast Renamer
            </p>
            <p className="text-[10px] text-muted-foreground/50 hidden sm:block">
              {t('topbar.tagline', { version: APP_VERSION })}
            </p>
          </div>
        </div>

        <div className="h-6 w-px bg-border hidden sm:block" />

        <div className="app-no-drag flex flex-wrap items-center gap-2">
          <Button variant="default" size="sm" onClick={onOpenAddSources} disabled={mutating}>
            <FileInput className="h-3.5 w-3.5" />
            {t('topbar.add')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={topBarGhostButtonClassName}
            onClick={onClearSources}
            disabled={sourceCount === 0 || mutating}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('topbar.clear')}
          </Button>
          <Button variant="ghost" size="sm" className={topBarGhostButtonClassName} onClick={onOpenPresets}>
            <Save className="h-3.5 w-3.5" />
            {t('topbar.presets')}
          </Button>
          <Button variant="ghost" size="sm" className={topBarGhostButtonClassName} onClick={onOpenHistory}>
            <Clock3 className="h-3.5 w-3.5" />
            {t('topbar.history')}
          </Button>
          <Button variant="ghost" size="sm" className={topBarGhostButtonClassName} onClick={onOpenSettings}>
            <Settings2 className="h-3.5 w-3.5" />
            {t('topbar.settings')}
          </Button>
        </div>

        <div className="flex-1" />

        <div className="app-no-drag flex items-center gap-1.5">
          <div className="hidden lg:flex items-center gap-2 rounded-lg border border-border bg-surface/70 px-2 py-1">
            <span id={sortLabelId} className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('sources.sort')}
            </span>
            <Select
              value={sortMode}
              disabled={mutating}
              onValueChange={(value) => onChangeSortMode(value as SortMode)}
            >
              <SelectTrigger aria-labelledby={sortLabelId} className="h-8 w-[170px] border-border/70 bg-card/80 px-2.5 text-xs shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {SORT_MODE_OPTIONS.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {sortModeMeta[mode].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="h-6 w-px bg-border mx-0.5 hidden lg:block" />

          <Tooltip content={t('topbar.refresh_preview')}>
            <IconButton
              disabled={mutating || previewLoading || sourceCount === 0}
              onClick={onRefresh}
              aria-label={t('topbar.refresh_preview')}
            >
              <RefreshCcw className={cn('h-4 w-4', previewLoading && 'animate-spin')} />
            </IconButton>
          </Tooltip>

          <Tooltip content={t('topbar.undo_last')}>
            <IconButton disabled={undoDisabled} onClick={onUndo} aria-label={t('history.undo')}>
              <Undo2 className={cn('h-4 w-4', mutation === 'undo' && 'animate-spin')} />
            </IconButton>
          </Tooltip>

          <div className="h-6 w-px bg-border mx-0.5" />

          <Button
            size="sm"
            disabled={renameDisabled}
            onClick={onExecute}
          >
            {t('topbar.rename')}
            {preview.summary.changed > 0 && (
              <span className="ml-0.5 rounded bg-accent-foreground/20 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums">
                {preview.summary.changed}
              </span>
            )}
          </Button>

          <div className="h-6 w-px bg-border mx-0.5" />

          <DropdownMenuRoot>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label={t('topbar.choose_theme_aria', { themeName: getThemeName(theme, t) })}>
                <Palette className="h-4 w-4" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuLabel>{t('topbar.themes')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {themes.map((candidate) => (
                <DropdownMenuItem key={candidate.id} onClick={() => onSelectTheme(candidate.id)}>
                  <span
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: candidate.tokens.accent }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{getThemeName(candidate, t)}</div>
                    <div className="text-xs text-muted-foreground">
                      {candidate.kind === 'custom' ? t('topbar.theme_custom') : t('topbar.theme_preset')}
                    </div>
                  </div>
                  {candidate.id === theme.id && <CheckCircle2 className="h-4 w-4 text-accent" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenuRoot>

          {!isMac && (
            <>
              <div className="h-6 w-px bg-border mx-0.5" />

              <div className="flex items-center gap-1">
                <Tooltip content={t('topbar.minimize')}>
                  <IconButton
                    className="h-8 w-8 rounded-lg hover:bg-surface-elevated"
                    onClick={onMinimizeWindow}
                    aria-label={t('topbar.minimize_window')}
                  >
                    <Minus className="h-4 w-4" />
                  </IconButton>
                </Tooltip>
                <Tooltip content={windowState.isMaximized ? t('topbar.restore_down') : t('topbar.maximize')}>
                  <IconButton
                    className="h-8 w-8 rounded-lg hover:bg-surface-elevated"
                    onClick={onToggleMaximizeWindow}
                    aria-label={windowState.isMaximized ? t('topbar.restore_window') : t('topbar.maximize_window')}
                  >
                    {windowState.isMaximized ? (
                      <Copy className="h-3.5 w-3.5" />
                    ) : (
                      <Square className="h-3.5 w-3.5" />
                    )}
                  </IconButton>
                </Tooltip>
                <Tooltip content={t('topbar.close')}>
                  <IconButton
                    className="h-8 w-8 rounded-lg hover:bg-destructive/90 hover:text-white"
                    onClick={onCloseWindow}
                    aria-label={t('topbar.close_window')}
                  >
                    <X className="h-4 w-4" />
                  </IconButton>
                </Tooltip>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="app-no-drag flex flex-wrap items-center gap-2 border-t border-border bg-surface/40 px-4 py-2 sm:px-5">
        <Badge dot tone="ok">{t('topbar.status.ok', { count: preview.summary.ok })}</Badge>
        <Badge dot tone="conflict">{t('topbar.status.conflicts', { count: preview.summary.conflict })}</Badge>
        <Badge dot tone="invalid">{t('topbar.status.invalid', { count: preview.summary.invalid })}</Badge>
        <Badge dot tone="unchanged">{t('topbar.status.unchanged', { count: preview.summary.unchanged })}</Badge>
        <Badge dot>{selectedLabel}</Badge>

        {skippedDirectories > 0 && (
          <Badge dot tone="invalid">{t('preview.skipped_directories', { count: skippedDirectories })}</Badge>
        )}

        {(mutating || previewLoading) && (
          <span className="flex items-center gap-1.5 text-xs text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
            {mutation === 'execute'
              ? t('topbar.busy.execute')
              : mutation === 'undo'
                ? t('topbar.busy.undo')
                : t('topbar.busy.preview')}
          </span>
        )}

        {(error || previewError) && (
          <span className="ml-auto flex flex-col items-end gap-0.5 text-xs text-conflict">
            {error && <span>⚠ {error}</span>}
            {previewError && <span>⚠ {previewError}</span>}
          </span>
        )}
      </div>
    </Panel>
  );
}
