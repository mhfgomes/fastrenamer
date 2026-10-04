import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryEntry, Preset, RenameRule } from '@fastrenamer/rename-engine/types';
import type { AppPreviewRequest, WindowState } from '@shared/contracts';
import { ToastProvider, ToastViewport, cn } from './components/ui';
import { useI18n } from './i18n';
import { TopBar } from './components/TopBar';
import { DEFAULT_WINDOW_STATE, STATUS_OPTIONS, type StatusFilter } from './app/defaults';
import { detectPlatform, getSelectedLabel, getSortModeMeta, isFileDropEvent } from './app/source-meta';
import { createRule, moveRule, reorderRule } from './app/rule-utils';
import { getErrorMessage } from './app/ipc-errors';
import { useThemeManager } from './hooks/useThemeManager';
import { usePanelResize } from './hooks/usePanelResize';
import { usePreviewSession } from './hooks/usePreviewSession';
import { useSourceSelection } from './hooks/useSourceSelection';
import { useUpdates } from './hooks/useUpdates';
import { PreviewPanel } from './components/preview/PreviewPanel';
import { RulesPanel } from './components/rules/RulesPanel';
import { PresetsDrawer } from './components/presets/PresetsDrawer';
import { HistoryDrawer } from './components/history/HistoryDrawer';
import { SettingsDrawer } from './components/settings/SettingsDrawer';
import { AddSourcesDialog } from './components/sources/AddSourcesDialog';
import { UpdateToast } from './components/updates/UpdateToast';
import { NoticeBanner, type AppNotice } from './components/NoticeBanner';

export function App() {
  const { t } = useI18n();
  const platform = useMemo(detectPlatform, []);
  const sortModeMeta = useMemo(() => getSortModeMeta(t), [t]);
  const themeManager = useThemeManager();

  const [rules, setRules] = useState<RenameRule[]>([]);
  const [statusFilters, setStatusFilters] = useState<StatusFilter[]>([...STATUS_OPTIONS]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [presetDrawerOpen, setPresetDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [windowState, setWindowState] = useState<WindowState>(DEFAULT_WINDOW_STATE);
  const [notices, setNotices] = useState<AppNotice[]>([]);
  const noticeId = useRef(0);
  const startupLoaded = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;

  // The preview session is created after the source selection (it needs the request), but the
  // source selection must report errors to it and respect its mutation lock: bridge with a ref.
  const sessionRef = useRef<ReturnType<typeof usePreviewSession> | null>(null);
  const reportError = useCallback((message: string | null) => sessionRef.current?.setActionError(message), []);
  const isMutatingNow = useCallback(() => sessionRef.current?.isMutatingNow() ?? false, []);

  const pushNotice = useCallback((notice: Omit<AppNotice, 'id'>) => {
    noticeId.current += 1;
    const id = noticeId.current;
    setNotices((current) => [...current, { ...notice, id }]);
  }, []);
  const dismissNotice = useCallback((id: number) => {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const reloadMetadata = useCallback(async () => {
    try {
      const [presetList, historyList] = await Promise.all([
        window.advancedRenamer.listPresets(),
        window.advancedRenamer.listHistory(),
      ]);
      setPresets(presetList);
      setHistory(historyList);
    } catch (error) {
      reportError(getErrorMessage(error, tRef.current('error.load_metadata')));
    }
  }, [reportError]);

  const sourceSelection = useSourceSelection({ t, isLocked: isMutatingNow, onError: reportError });
  const { sources, sourceMode, fileNamePattern, sortMode } = sourceSelection;

  const sourcePaths = useMemo(() => sources.map((source) => source.path), [sources]);
  const previewRequest = useMemo<AppPreviewRequest>(
    () => ({ sourcePaths, sourceMode, fileNamePattern, sortMode, rules }),
    [fileNamePattern, rules, sortMode, sourceMode, sourcePaths],
  );

  const session = usePreviewSession({
    request: previewRequest,
    api: window.advancedRenamer,
    t,
    onRenamed: sourceSelection.resetSources,
    onMetadataChanged: reloadMetadata,
    onNotice: pushNotice,
  });
  sessionRef.current = session;

  const updates = useUpdates({ t, onOpenSettings: () => setSettingsDrawerOpen(true) });
  const panels = usePanelResize();

  useEffect(() => {
    if (startupLoaded.current) return;
    startupLoaded.current = true;
    void reloadMetadata();
    window.advancedRenamer.getStartupNotices().then(
      (startupNotices) => startupNotices.forEach(pushNotice),
      () => {},
    );
  }, [pushNotice, reloadMetadata]);

  useEffect(() => {
    let mounted = true;

    void window.advancedRenamer.getWindowState().then((state) => {
      if (mounted) {
        setWindowState(state);
      }
    });

    const unsubscribe = window.advancedRenamer.onWindowStateChanged((state) => {
      setWindowState(state);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const onAddRule = useCallback((type: RenameRule['type']) => setRules((cur) => [...cur, createRule(type)]), []);
  const onUpdateRule = useCallback(
    (ruleId: string, updater: (rule: RenameRule) => RenameRule) =>
      setRules((cur) => cur.map((rule) => (rule.id === ruleId ? updater(rule) : rule))),
    [],
  );
  const onMoveRule = useCallback(
    (ruleId: string, dir: 'up' | 'down') => setRules((cur) => moveRule(cur, ruleId, dir)),
    [],
  );
  const onReorderRule = useCallback(
    (draggedRuleId: string, targetRuleId: string) =>
      setRules((cur) => reorderRule(cur, draggedRuleId, targetRuleId)),
    [],
  );
  const onDeleteRule = useCallback(
    (ruleId: string) => setRules((cur) => cur.filter((rule) => rule.id !== ruleId)),
    [],
  );
  const replaceRules = useCallback((next: RenameRule[]) => {
    if (!isMutatingNow()) setRules(next);
  }, [isMutatingNow]);
  const onToggleFilter = useCallback((status: StatusFilter) => {
    setStatusFilters((cur) => (cur.includes(status) ? cur.filter((s) => s !== status) : [...cur, status]));
  }, []);

  const lastUndoable = history.find((entry) => entry.canUndo);
  const { preview, mutation, isMutating } = session;

  return (
    <div
      className={cn(
        'h-screen overflow-hidden text-foreground',
        !windowState.isMaximized && 'p-2',
      )}
      onDragOver={(event) => {
        if (!isFileDropEvent(event)) {
          return;
        }
        event.preventDefault();
        if (!dragActive) {
          setDragActive(true);
        }
      }}
      onDragLeave={(event) => {
        if (!isFileDropEvent(event)) {
          return;
        }
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setDragActive(false);
      }}
      onDrop={(event) => {
        setDragActive(false);
        void sourceSelection.handleDrop(event);
      }}
    >
      <div
        className={cn(
          'flex h-full flex-col',
          !windowState.isMaximized && 'mx-auto max-w-[1800px]',
        )}
      >

        {/* Top bar */}
        <div className="shrink-0 pb-2">
          <TopBar
            platform={platform}
            theme={themeManager.theme}
            themes={themeManager.themes}
            windowState={windowState}
            sourceCount={sources.length}
            selectedLabel={getSelectedLabel(sources, t)}
            sortMode={sortMode}
            sortModeMeta={sortModeMeta}
            preview={preview}
            previewLoading={session.previewLoading}
            mutation={mutation}
            renameDisabled={!session.canExecute}
            error={session.actionError}
            previewError={session.previewError}
            skippedDirectories={session.isPreviewCurrent ? preview.skippedDirectories : 0}
            undoDisabled={!lastUndoable || isMutating}
            t={t}
            onOpenAddSources={sourceSelection.openAddSources}
            onClearSources={sourceSelection.clearSources}
            onRefresh={session.refreshPreview}
            onExecute={() => void session.executeRename()}
            onUndo={() => lastUndoable && void session.undoBatch(lastUndoable.id)}
            onOpenPresets={() => setPresetDrawerOpen(true)}
            onOpenHistory={() => setHistoryDrawerOpen(true)}
            onOpenSettings={() => setSettingsDrawerOpen(true)}
            onSelectTheme={themeManager.setTheme}
            onChangeSortMode={sourceSelection.setSortMode}
            onMinimizeWindow={() => void window.advancedRenamer.minimizeWindow()}
            onToggleMaximizeWindow={() =>
              void window.advancedRenamer.toggleMaximizeWindow().then(setWindowState)
            }
            onCloseWindow={() => void window.advancedRenamer.closeWindow()}
          />
        </div>

        <NoticeBanner notices={notices} onDismiss={dismissNotice} />

        {/* Separator */}
        <div className="shrink-0 border-t border-border mb-2" />

        {/* Main panels */}
        <div ref={panels.containerRef} className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 lg:flex-row lg:gap-0">
          <div
            ref={panels.leftPanelRef}
            className="h-full lg:shrink-0"
            style={panels.isDesktop ? { width: `${panels.leftWidthRatio * 100}%` } : undefined}
          >
            <RulesPanel
              rules={rules}
              disabled={isMutating}
              onAddRule={onAddRule}
              onUpdateRule={onUpdateRule}
              onMoveRule={onMoveRule}
              onReorderRule={onReorderRule}
              onDeleteRule={onDeleteRule}
            />
          </div>

          {panels.isDesktop && (
            <div
              className="flex h-full w-3 shrink-0 cursor-col-resize select-none items-center justify-center group"
              onMouseDown={panels.onSplitterMouseDown}
            >
              <div className="h-full w-px bg-border transition-colors duration-150 group-hover:bg-accent" />
            </div>
          )}

          <div className="h-full min-w-0 flex-1">
            <PreviewPanel preview={preview} statusFilters={statusFilters} onToggleFilter={onToggleFilter} />
          </div>
        </div>
      </div>

      {dragActive && (
        <div className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center bg-accent/10 backdrop-blur-[2px]">
          <div className="rounded-2xl border border-accent/40 bg-card/95 px-8 py-6 text-center shadow-2xl">
            <div className="text-sm font-semibold text-foreground">{t('app.drop.title')}</div>
            <div className="mt-2 text-xs text-muted-foreground">{t('app.drop.description')}</div>
          </div>
        </div>
      )}

      <AddSourcesDialog dialog={sourceSelection.dialog} />

      <PresetsDrawer
        open={presetDrawerOpen}
        onOpenChange={setPresetDrawerOpen}
        presets={presets}
        rules={rules}
        loadDisabled={isMutating}
        onLoadRules={replaceRules}
        onPresetsChanged={reloadMetadata}
      />

      <HistoryDrawer
        open={historyDrawerOpen}
        onOpenChange={setHistoryDrawerOpen}
        history={history}
        mutating={isMutating}
        onReuseRules={replaceRules}
        onUndo={(batchId) => void session.undoBatch(batchId)}
      />

      <SettingsDrawer
        open={settingsDrawerOpen}
        onOpenChange={setSettingsDrawerOpen}
        platform={platform}
        updates={updates}
        themeManager={themeManager}
      />

      <ToastProvider swipeDirection="right">
        {updates.updateToast && (
          <UpdateToast
            key={updates.updateToast.id}
            toast={updates.updateToast}
            onOpenChange={updates.setUpdateToastOpen}
            onAction={updates.handleUpdateToastAction}
          />
        )}
        <ToastViewport />
      </ToastProvider>
    </div>
  );
}
