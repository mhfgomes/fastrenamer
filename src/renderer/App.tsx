import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  AlertTriangle,
  FileInput,
  Info,
  Plus,
  Palette,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import type { DragEvent } from 'react';
import type {
  HistoryEntry,
  Preset,
  PreviewResult,
  SourceMode,
  RenameRule,
  SortMode,
  SourceSelection,
} from '@fast-renamer/rename-engine/types';
import type { UpdateChannel, UpdateState, WindowState } from '@shared/contracts';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  IconButton,
  Input,
  Modal,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  cn,
} from './components/ui';
import { AVAILABLE_LOCALES, useI18n, type AppLocale } from './i18n';
import { TopBar } from './components/TopBar';
import { APP_VERSION, SORT_MODE_OPTIONS } from './constants';
import {
  DEFAULT_PREVIEW,
  DEFAULT_UPDATE_STATE,
  DEFAULT_WINDOW_STATE,
  LEFT_WIDTH_STORAGE_KEY,
  SORT_MODE_STORAGE_KEY,
  DEFAULT_LEFT_WIDTH_RATIO,
  SOURCE_MODE_OPTIONS,
  STATUS_OPTIONS,
  type StatusFilter,
} from './app/defaults';
import {
  detectPlatform,
  getAvailableSourceModes,
  getSelectedLabel,
  getSortModeMeta,
  getSourceModeMeta,
  isFileDropEvent,
  sortSourceSelections,
} from './app/source-meta';
import { createRule, moveRule, reorderRule } from './app/rule-utils';
import { clampLeftWidthRatio } from './app/layout';
import { useThemeManager } from './hooks/useThemeManager';
import {
  formatBytes,
  getUpdateStatusLabel,
  getUpdateSummary,
  getUpdateTone,
  type UpdateToastState,
} from './app/update-utils';
import { getUndoStatusLabel } from './app/history-utils';
import { SettingsSection, ThemeOptionCard, ThemeTokenEditor } from './components/settings/SettingsTheme';
import { PreviewPanel } from './components/preview/PreviewPanel';
import { RulesPanel } from './components/rules/RulesPanel';
import { PresetList } from './components/presets/PresetList';
import { THEME_TOKEN_FIELDS } from './themes';

type SettingsSectionId = 'updates' | 'executionProfile' | 'platformRules' | 'appearance' | 'language';

export function App() {
  const { locale, setLocale, t } = useI18n();
  const platform = useMemo(detectPlatform, []);
  const sourceModeMeta = useMemo(() => getSourceModeMeta(t), [t]);
  const sortModeMeta = useMemo(() => getSortModeMeta(t), [t]);
  const {
    theme,
    themes,
    setTheme,
    cycleTheme,
    createThemeFromActive,
    createThemeFromId,
    renameCustomTheme,
    updateCustomThemeToken,
    deleteCustomTheme,
  } = useThemeManager();

  const [sources, setSources] = useState<SourceSelection[]>([]);
  const [sourceMode, setSourceMode] = useState<SourceMode>('picked_files');
  const [fileNamePattern, setFileNamePattern] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const stored = localStorage.getItem(SORT_MODE_STORAGE_KEY);
    return stored === 'natural_path' ||
      stored === 'alphabetic_path' ||
      stored === 'name_only' ||
      stored === 'folder_then_name'
      ? stored
      : 'natural_path';
  });
  const [rules, setRules] = useState<RenameRule[]>([]);
  const [preview, setPreview] = useState<PreviewResult>(DEFAULT_PREVIEW);
  const [statusFilters, setStatusFilters] = useState<StatusFilter[]>([...STATUS_OPTIONS]);
  const [busy, setBusy] = useState<'idle' | 'preview' | 'execute' | 'undo'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [presetDrawerOpen, setPresetDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [settingsDrawerOpen, setSettingsDrawerOpen] = useState(false);
  const [addSourcesOpen, setAddSourcesOpen] = useState(false);
  const [openSettingsSection, setOpenSettingsSection] = useState<SettingsSectionId | null>(null);
  const [presetName, setPresetName] = useState('');
  const [presetSearch, setPresetSearch] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [presetTransferMessage, setPresetTransferMessage] = useState<string | null>(null);
  const [draftSourceMode, setDraftSourceMode] = useState<SourceMode>(sourceMode);
  const [draftFileNamePattern, setDraftFileNamePattern] = useState(fileNamePattern);
  const [draftSortMode, setDraftSortMode] = useState<SortMode>(sortMode);
  const [pendingSourcePick, setPendingSourcePick] = useState<{
    mode: SourceMode;
    fileNamePattern: string;
    sortMode: SortMode;
  } | null>(null);
  const [pendingDroppedSources, setPendingDroppedSources] = useState<SourceSelection[] | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [windowState, setWindowState] = useState<WindowState>(DEFAULT_WINDOW_STATE);
  const [updateState, setUpdateState] = useState<UpdateState>(DEFAULT_UPDATE_STATE);
  const [updateAction, setUpdateAction] = useState<'idle' | 'checking' | 'installing'>('idle');
  const [updateToast, setUpdateToast] = useState<UpdateToastState | null>(null);

  const [leftWidthRatio, setLeftWidthRatio] = useState(() => {
    const stored = Number(localStorage.getItem(LEFT_WIDTH_STORAGE_KEY));
    const fallbackContainerWidth = Math.max(window.innerWidth - 16, 1);
    if (Number.isFinite(stored)) {
      if (stored > 1) {
        // Migrate older fixed-pixel widths to the new proportional layout.
        return clampLeftWidthRatio(stored / fallbackContainerWidth, fallbackContainerWidth);
      }
      return clampLeftWidthRatio(stored, fallbackContainerWidth);
    }
    return clampLeftWidthRatio(DEFAULT_LEFT_WIDTH_RATIO, fallbackContainerWidth);
  });
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024);
  const isResizing = useRef(false);
  const desktopLayoutRef = useRef<HTMLDivElement | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidthRatio = useRef(0);
  const resizeContainerWidth = useRef(0);
  const previousUpdateStatus = useRef<UpdateState['status'] | null>(null);
  const updateToastId = useRef(0);
  const previewGenerationRef = useRef(0);

  const sourcePaths = useMemo(() => sources.map((s) => s.path), [sources]);
  const previewRequest = useMemo(
    () => ({ sourcePaths, sourceMode, fileNamePattern, sortMode, rules, platform }),
    [fileNamePattern, platform, rules, sortMode, sourceMode, sourcePaths],
  );
  const sortedSourceDialogItems = useMemo(
    () => sortSourceSelections(pendingDroppedSources ?? sources, draftSortMode),
    [draftSortMode, pendingDroppedSources, sources],
  );

  useEffect(() => { void reloadMetadata(); }, []);

  useEffect(() => {
    if (sources.length === 0) {
      previewGenerationRef.current += 1;
      setPreview(DEFAULT_PREVIEW);
      return;
    }
    const t = window.setTimeout(() => { void refreshPreview(); }, 180);
    return () => {
      window.clearTimeout(t);
      previewGenerationRef.current += 1;
    };
  }, [previewRequest, sources.length]);

  useEffect(() => {
    if (addSourcesOpen || !pendingSourcePick) {
      return;
    }

    const nextPick = pendingSourcePick;
    setPendingSourcePick(null);

    void (async () => {
      try {
        setError(null);
        setSourceMode(nextPick.mode);
        setFileNamePattern(nextPick.fileNamePattern);
        setSortMode(nextPick.sortMode);
        const picked = await window.advancedRenamer.pickSources({ mode: nextPick.mode });
        setSources(sortSourceSelections(picked, nextPick.sortMode));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('error.source_picker'));
      }
    })();
  }, [addSourcesOpen, pendingSourcePick, t]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const mqHandler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', mqHandler);

    function onMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const containerWidth = resizeContainerWidth.current;
      if (containerWidth <= 0) return;
      const deltaRatio = (e.clientX - resizeStartX.current) / containerWidth;
      setLeftWidthRatio(clampLeftWidthRatio(resizeStartWidthRatio.current + deltaRatio, containerWidth));
    }
    function onMouseUp() { isResizing.current = false; }
    function onWindowResize() {
      const containerWidth = desktopLayoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      setLeftWidthRatio((current) => clampLeftWidthRatio(current, containerWidth));
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('resize', onWindowResize);

    return () => {
      mq.removeEventListener('change', mqHandler);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('resize', onWindowResize);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(LEFT_WIDTH_STORAGE_KEY, String(leftWidthRatio));
  }, [leftWidthRatio]);

  useEffect(() => {
    localStorage.setItem(SORT_MODE_STORAGE_KEY, sortMode);
    setSources((current) => sortSourceSelections(current, sortMode));
  }, [sortMode]);

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

  useEffect(() => {
    let mounted = true;

    const handleUpdateStateChange = (state: UpdateState, notify: boolean) => {
      previousUpdateStatus.current = state.status;
      setUpdateState(state);
      setUpdateAction((current) => {
        if (state.status === 'checking') {
          return current === 'installing' ? current : 'checking';
        }
        if (state.status === 'installing') {
          return 'installing';
        }
        return 'idle';
      });

      if (!notify) {
        return;
      }

      if (state.status === 'available') {
        showUpdateToast({
          tone: 'accent',
          title: t('toast.update_found.title'),
          description: state.manualDownloadOnly
            ? t('toast.update_found.description_manual', { version: state.availableVersion ?? 'unknown' })
            : t('toast.update_found.description_auto', { version: state.availableVersion ?? 'unknown' }),
          actionLabel: state.manualDownloadOnly ? t('updates.download') : t('toast.open_settings'),
          actionKind: state.manualDownloadOnly ? 'download-update' : 'open-settings',
        });
      }

      if (state.status === 'downloaded') {
        showUpdateToast({
          tone: 'ok',
          title: t('toast.update_ready.title'),
          description: t('toast.update_ready.description', { version: state.availableVersion ?? 'unknown' }),
          actionLabel: t('toast.restart_now'),
          actionKind: 'install-update',
        });
      }

      if (state.status === 'error') {
        showUpdateToast({
          tone: 'conflict',
          title: t('toast.update_failed.title'),
          description: state.message ?? t('updates.summary.error'),
          actionLabel: t('toast.open_settings'),
          actionKind: 'open-settings',
        });
      }
    };

    void window.advancedRenamer.getUpdateState().then((state) => {
      if (!mounted) {
        return;
      }
      previousUpdateStatus.current = state.status;
      setUpdateState(state);
    });

    const unsubscribe = window.advancedRenamer.onUpdateStateChanged((state) => {
      if (!mounted) {
        return;
      }

      const shouldNotify =
        state.status !== previousUpdateStatus.current &&
        (state.status === 'available' || state.status === 'downloaded' || state.status === 'error');

      handleUpdateStateChange(state, shouldNotify);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [t]);

  async function reloadMetadata() {
    const [presetList, historyList] = await Promise.all([
      window.advancedRenamer.listPresets(),
      window.advancedRenamer.listHistory(),
    ]);
    setPresets(presetList);
    setHistory(historyList);
  }

  function showUpdateToast(input: Omit<UpdateToastState, 'id' | 'open'>) {
    updateToastId.current += 1;
    setUpdateToast({
      id: updateToastId.current,
      open: true,
      ...input,
    });
  }

  function openAddSources() {
    setPendingDroppedSources(null);
    setDraftSourceMode(sourceMode);
    setDraftFileNamePattern(fileNamePattern);
    setDraftSortMode(sortMode);
    setAddSourcesOpen(true);
  }

  async function checkForUpdates() {
    setUpdateAction('checking');
    try {
      const nextState = await window.advancedRenamer.checkForUpdates();
      setUpdateState(nextState);
    } finally {
      setUpdateAction((current) => (current === 'checking' ? 'idle' : current));
    }
  }

  async function changeUpdateChannel(channel: UpdateChannel) {
    if (channel === updateState.channel) {
      return;
    }

    setUpdateAction('checking');
    try {
      const nextState = await window.advancedRenamer.setUpdateChannel(channel);
      setUpdateState(nextState);
    } finally {
      setUpdateAction((current) => (current === 'checking' ? 'idle' : current));
    }
  }

  async function installUpdate() {
    setUpdateAction('installing');
    const started = await window.advancedRenamer.quitAndInstallUpdate();
    if (!started) {
      setUpdateAction('idle');
    }
  }

  async function openUpdateDownload() {
    setUpdateAction('installing');
    try {
      await window.advancedRenamer.openUpdateDownload();
    } finally {
      setUpdateAction('idle');
    }
  }

  function handleUpdateToastAction(actionKind?: UpdateToastState['actionKind']) {
    if (!actionKind) {
      return;
    }

    if (actionKind === 'open-settings') {
      setSettingsDrawerOpen(true);
      setUpdateToast((current) => (current ? { ...current, open: false } : current));
      return;
    }

    if (actionKind === 'download-update') {
      setUpdateToast((current) => (current ? { ...current, open: false } : current));
      void openUpdateDownload();
      return;
    }

    void installUpdate();
  }

  function toggleSettingsSection(section: SettingsSectionId) {
    setOpenSettingsSection((current) => (current === section ? null : section));
  }

  function clearSources() {
    setSources([]);
    setPreview(DEFAULT_PREVIEW);
    setError(null);
    setPendingSourcePick(null);
  }

  function chooseSourcesFromDialog() {
    if (pendingDroppedSources) {
      const nextSources =
        draftSourceMode === 'picked_files'
          ? pendingDroppedSources.filter((source) => !source.isDirectory)
          : draftSourceMode === 'picked_folders'
            ? pendingDroppedSources.filter((source) => source.isDirectory)
            : pendingDroppedSources.filter((source) => source.isDirectory);

      if (nextSources.length === 0) {
        setError(t('error.dropped_mode'));
        return;
      }

      setError(null);
      setSourceMode(draftSourceMode);
      setFileNamePattern(draftFileNamePattern);
      setSortMode(draftSortMode);
      setSources(sortSourceSelections(nextSources, draftSortMode));
      setPendingDroppedSources(null);
      setAddSourcesOpen(false);
      return;
    }

    setPendingSourcePick({
      mode: draftSourceMode,
      fileNamePattern: draftFileNamePattern,
      sortMode: draftSortMode,
    });
    setAddSourcesOpen(false);
  }

  function handleDraftSourceModeChange(nextMode: SourceMode) {
    setDraftSourceMode(nextMode);
    if (!sourceModeMeta[nextMode].supportsFilter) {
      setDraftFileNamePattern('');
    }
  }

  function removeSourceFromDialog(sourcePath: string) {
    if (pendingDroppedSources) {
      const nextSources = sortSourceSelections(
        pendingDroppedSources.filter((source) => source.path !== sourcePath),
        draftSortMode,
      );
      setPendingDroppedSources(nextSources);

      const availableModes = getAvailableSourceModes(nextSources);
      if (availableModes.length === 0) {
        setAddSourcesOpen(false);
        return;
      }

      if (!availableModes.includes(draftSourceMode)) {
        const nextMode = availableModes.includes('files_recursive')
          ? 'files_recursive'
          : availableModes[0];
        setDraftSourceMode(nextMode);
        if (!sourceModeMeta[nextMode].supportsFilter) {
          setDraftFileNamePattern('');
        }
      }
      return;
    }

    setSources((current) => sortSourceSelections(current.filter((source) => source.path !== sourcePath), sortMode));
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);

    if (!isFileDropEvent(event)) {
      return;
    }

    const droppedPaths = window.advancedRenamer.getDroppedPaths(
      Array.from(event.dataTransfer.files),
    );

    if (droppedPaths.length === 0) {
      setError(t('error.dropped_paths'));
      return;
    }

    try {
      setError(null);
      const resolved = await window.advancedRenamer.resolveSources(droppedPaths);
      const hasDirectories = resolved.some((source) => source.isDirectory);

      if (!hasDirectories) {
        setSourceMode('picked_files');
        setFileNamePattern('');
        setSources(sortSourceSelections(resolved, sortMode));
        return;
      }

      const availableModes = getAvailableSourceModes(resolved);
      const nextDefaultMode = availableModes.includes(sourceMode)
        ? sourceMode
        : availableModes.includes('picked_folders')
          ? 'picked_folders'
        : availableModes.includes('files_recursive')
          ? 'files_recursive'
          : availableModes[0];

      setPendingDroppedSources(sortSourceSelections(resolved, sortMode));
      setDraftSourceMode(nextDefaultMode);
      setDraftFileNamePattern('');
      setDraftSortMode(sortMode);
      setAddSourcesOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.read_dropped'));
    }
  }

  async function refreshPreview() {
    if (previewRequest.sourcePaths.length === 0) return;
    const generation = ++previewGenerationRef.current;
    setBusy('preview');
    setError(null);
    try {
      const next = await window.advancedRenamer.generatePreview(previewRequest);
      if (generation !== previewGenerationRef.current) {
        return;
      }
      startTransition(() => setPreview(next));
    } catch (err) {
      if (generation !== previewGenerationRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : t('error.generate_preview'));
    } finally {
      if (generation === previewGenerationRef.current) {
        setBusy('idle');
      }
    }
  }

  async function executeRename() {
    setBusy('execute');
    setError(null);
    try {
      const result = await window.advancedRenamer.executeRenameBatch(previewRequest);
      if (result.errors.length > 0) setError(result.errors.join(' '));
      if (result.renamedCount > 0 && result.errors.length === 0) {
        clearSources();
      } else {
        setPreview(result);
      }
      await reloadMetadata();
    } finally {
      setBusy('idle');
    }
  }

  async function undoLast(batchId: number) {
    setBusy('undo');
    setError(null);
    try {
      const result = await window.advancedRenamer.undoRenameBatch({ batchId });
      if (!result.success && result.errors.length > 0) setError(result.errors.join(' '));
      await reloadMetadata();
      await refreshPreview();
    } finally {
      setBusy('idle');
    }
  }

  async function savePreset() {
    if (!presetName.trim()) { setError(t('error.preset_name_required')); return; }
    await window.advancedRenamer.savePreset({ id: selectedPresetId ?? undefined, name: presetName.trim(), rules });
    setPresetName('');
    setSelectedPresetId(null);
    setPresetTransferMessage(null);
    await reloadMetadata();
  }

  async function exportUserPresets() {
    setError(null);
    try {
      const result = await window.advancedRenamer.exportUserPresets();
      if (!result.canceled) {
        setPresetTransferMessage(t('presets.exported', { count: result.exportedCount }));
      }
    } catch (err) {
      setPresetTransferMessage(null);
      setError(err instanceof Error ? err.message : t('error.export_presets'));
    }
  }

  async function exportUserPreset(preset: Preset) {
    setError(null);
    try {
      const result = await window.advancedRenamer.exportUserPreset(preset.id);
      if (!result.canceled) {
        setPresetTransferMessage(t('presets.exported', { count: result.exportedCount }));
      }
    } catch (err) {
      setPresetTransferMessage(null);
      setError(err instanceof Error ? err.message : t('error.export_presets'));
    }
  }

  async function importUserPresets() {
    setError(null);
    try {
      const result = await window.advancedRenamer.importUserPresets();
      if (!result.canceled) {
        setPresetTransferMessage(t('presets.imported', { count: result.importedCount }));
        await reloadMetadata();
      }
    } catch (err) {
      setPresetTransferMessage(null);
      setError(err instanceof Error ? err.message : t('error.import_presets'));
    }
  }

  const lastUndoable = history.find((e) => e.canUndo);
  const filteredRows = preview.rows.filter((row) => statusFilters.includes(row.status));
  const filteredPresets = presets.filter((preset) => {
    const needle = presetSearch.trim().toLowerCase();
    if (!needle) {
      return true;
    }

    return preset.name.toLowerCase().includes(needle);
  });
  const availableDraftModes = pendingDroppedSources
    ? getAvailableSourceModes(pendingDroppedSources)
    : SOURCE_MODE_OPTIONS;
  const sourceDialogTitle = pendingDroppedSources ? t('sources.add.dropped_title') : t('sources.add.title');
  const sourceDialogDescription = pendingDroppedSources
    ? t('sources.add.dropped_description')
    : t('sources.add.description');
  const sourceDialogButtonLabel = pendingDroppedSources
    ? t('sources.add.dropped_title')
    : sourceModeMeta[draftSourceMode].pickerLabel;
  const sourceDialogRootCount = pendingDroppedSources?.length ?? sources.length;
  const activeCustomTheme = theme.kind === 'custom' ? theme : null;

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
      onDrop={(event) => void handleDrop(event)}
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
            theme={theme}
            themes={themes}
            windowState={windowState}
            sourceCount={sources.length}
            selectedLabel={getSelectedLabel(sources, t)}
            sortMode={sortMode}
            sortModeMeta={sortModeMeta}
            preview={preview}
            busy={busy}
            error={error}
            undoDisabled={!lastUndoable || busy !== 'idle'}
            t={t}
            onOpenAddSources={openAddSources}
            onClearSources={clearSources}
            onRefresh={refreshPreview}
            onExecute={executeRename}
            onUndo={() => lastUndoable && void undoLast(lastUndoable.id)}
            onOpenPresets={() => setPresetDrawerOpen(true)}
            onOpenHistory={() => setHistoryDrawerOpen(true)}
            onOpenSettings={() => setSettingsDrawerOpen(true)}
            onSelectTheme={setTheme}
            onChangeSortMode={setSortMode}
            onMinimizeWindow={() => void window.advancedRenamer.minimizeWindow()}
            onToggleMaximizeWindow={() =>
              void window.advancedRenamer.toggleMaximizeWindow().then(setWindowState)
            }
            onCloseWindow={() => void window.advancedRenamer.closeWindow()}
          />
        </div>

        {/* Separator */}
        <div className="shrink-0 border-t border-border mb-2" />

        {/* Main panels */}
        <div ref={desktopLayoutRef} className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 lg:flex-row lg:gap-0">
          <div
            className="h-full lg:shrink-0"
            style={isDesktop ? { width: `${leftWidthRatio * 100}%` } : undefined}
          >
            <RulesPanel
              rules={rules}
              onAddRule={(type) => setRules((cur) => [...cur, createRule(type)])}
              onUpdateRule={(ruleId, updater) =>
                setRules((cur) => cur.map((r) => (r.id === ruleId ? updater(r) : r)))
              }
              onMoveRule={(ruleId, dir) => setRules((cur) => moveRule(cur, ruleId, dir))}
              onReorderRule={(draggedRuleId, targetRuleId) =>
                setRules((cur) => reorderRule(cur, draggedRuleId, targetRuleId))
              }
              onDeleteRule={(ruleId) => setRules((cur) => cur.filter((r) => r.id !== ruleId))}
            />
          </div>

          {isDesktop && (
            <div
              className="flex h-full w-3 shrink-0 cursor-col-resize select-none items-center justify-center group"
              onMouseDown={(e) => {
                const containerWidth =
                  desktopLayoutRef.current?.getBoundingClientRect().width ?? window.innerWidth;
                isResizing.current = true;
                resizeStartX.current = e.clientX;
                resizeStartWidthRatio.current = leftWidthRatio;
                resizeContainerWidth.current = containerWidth;
                e.preventDefault();
              }}
            >
              <div className="h-full w-px bg-border transition-colors duration-150 group-hover:bg-accent" />
            </div>
          )}

          <div className="h-full min-w-0 flex-1">
            <PreviewPanel
              preview={preview}
              rows={filteredRows}
              statusFilters={statusFilters}
              onToggleFilter={(status) =>
                setStatusFilters((cur) =>
                  cur.includes(status) ? cur.filter((s) => s !== status) : [...cur, status],
                )
              }
            />
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

      <Modal
        open={addSourcesOpen}
        onOpenChange={(open) => {
          setAddSourcesOpen(open);
          if (!open) {
            setPendingDroppedSources(null);
          }
        }}
        title={sourceDialogTitle}
        description={sourceDialogDescription}
      >
        <div className="space-y-5 p-5">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('sources.set')}
              </label>
              <Select
                value={draftSourceMode}
                onValueChange={(value) => handleDraftSourceModeChange(value as SourceMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableDraftModes.includes('picked_folders') && (
                    <SelectItem value="picked_folders">{sourceModeMeta.picked_folders.label}</SelectItem>
                  )}
                  {availableDraftModes.includes('picked_files') && (
                    <SelectItem value="picked_files">{sourceModeMeta.picked_files.label}</SelectItem>
                  )}
                  {availableDraftModes.includes('top_level_folders') && (
                    <SelectItem value="top_level_folders">{sourceModeMeta.top_level_folders.label}</SelectItem>
                  )}
                  {availableDraftModes.includes('subfolders') && (
                    <SelectItem value="subfolders">{sourceModeMeta.subfolders.label}</SelectItem>
                  )}
                  {availableDraftModes.includes('top_level_files') && (
                    <SelectItem value="top_level_files">{sourceModeMeta.top_level_files.label}</SelectItem>
                  )}
                  {availableDraftModes.includes('files_recursive') && (
                    <SelectItem value="files_recursive">{sourceModeMeta.files_recursive.label}</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{sourceModeMeta[draftSourceMode].detail}</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('sources.filter')}
              </label>
              <Input
                value={draftFileNamePattern}
                onChange={(e) => setDraftFileNamePattern(e.target.value)}
                placeholder={t('sources.filter.placeholder')}
                disabled={!sourceModeMeta[draftSourceMode].supportsFilter}
              />
              <p className="text-xs text-muted-foreground">
                {sourceModeMeta[draftSourceMode].supportsFilter
                  ? t('sources.filter.help_supported')
                  : t('sources.filter.help_unsupported')}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t('sources.sort')}
              </label>
              <Select
                value={draftSortMode}
                onValueChange={(value) => setDraftSortMode(value as SortMode)}
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
              {pendingDroppedSources ? t('sources.dropped') : t('sources.current')}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge dot tone="accent">{sourceModeMeta[draftSourceMode].label}</Badge>
              <Badge dot>{t('sources.sort.badge', { mode: sortModeMeta[draftSortMode].label })}</Badge>
              {draftFileNamePattern ? <Badge dot>{draftFileNamePattern}</Badge> : null}
              <Badge dot>{t('sources.roots', { count: sourceDialogRootCount })}</Badge>
            </div>
            {sortedSourceDialogItems.length > 0 && (
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto">
                {sortedSourceDialogItems.map((source) => (
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
                        onClick={() => removeSourceFromDialog(source.path)}
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
            <Button variant="ghost" onClick={() => setAddSourcesOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void chooseSourcesFromDialog()}>
              <FileInput className="h-3.5 w-3.5" />
              {sourceDialogButtonLabel}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Presets drawer */}
      <Drawer
        open={presetDrawerOpen}
        onOpenChange={setPresetDrawerOpen}
        title={t('presets.title')}
        description={t('presets.description')}
      >
        <div className="space-y-6 p-5">
          <div className="rounded-xl border border-border bg-surface p-4">
            <p className="text-sm font-semibold text-foreground">{t('presets.save_stack')}</p>
            <div className="mt-3 space-y-3">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder={t('presets.name.placeholder')}
              />
              <div className="flex gap-2">
                <Button onClick={() => void savePreset()}>
                  <Save className="h-3.5 w-3.5" />
                  {t('presets.save')}
                </Button>
                {selectedPresetId && (
                  <Button variant="secondary" onClick={() => setSelectedPresetId(null)}>
                    {t('presets.clear_target')}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-foreground">{t('presets.library')}</p>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <div className="w-full sm:w-64">
                  <Input
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    placeholder={t('presets.search.placeholder')}
                  />
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void importUserPresets()}>
                    <Upload className="h-3.5 w-3.5" />
                    {t('presets.import')}
                  </Button>
                  <Button variant="secondary" onClick={() => void exportUserPresets()}>
                    <Download className="h-3.5 w-3.5" />
                    {t('presets.export')}
                  </Button>
                </div>
              </div>
            </div>
            {presetTransferMessage && (
              <div className="rounded-lg border border-ok/20 bg-ok/10 px-3 py-2 text-xs font-medium text-ok">
                {presetTransferMessage}
              </div>
            )}
            <PresetList
              presets={filteredPresets}
              onLoad={(p) => {
                setRules(p.rules);
                setPresetDrawerOpen(false);
              }}
              onEdit={(p) => {
                setPresetName(p.name);
                setSelectedPresetId(p.id);
              }}
              onExport={(p) => void exportUserPreset(p)}
              onDelete={(p) => void window.advancedRenamer.deletePreset(p.id).then(reloadMetadata)}
              emptyMessage={presetSearch.trim() ? t('presets.empty_search') : t('presets.empty')}
            />
          </div>
        </div>
      </Drawer>

      {/* History drawer */}
      <Drawer
        open={historyDrawerOpen}
        onOpenChange={setHistoryDrawerOpen}
        title={t('history.title')}
        description={t('history.description')}
      >
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
                  disabled={entry.rules.length === 0}
                  onClick={() => setRules(entry.rules)}
                >
                  {t('history.reuse')}
                </Button>
                <Button
                  size="sm"
                  disabled={!entry.canUndo || busy !== 'idle'}
                  onClick={() => void undoLast(entry.id)}
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  {t('history.undo')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Drawer>

      {/* Settings drawer */}
      <Drawer
        open={settingsDrawerOpen}
        onOpenChange={setSettingsDrawerOpen}
        title={t('settings.title')}
        description={t('settings.description')}
      >
        <div className="space-y-3 p-5">
          <SettingsSection
            title={t('settings.updates')}
            badge={(
              <div className="flex items-center gap-2">
                <Badge tone="unchanged">
                  {updateState.channel === 'ea' ? t('updates.channel.ea') : t('updates.channel.stable')}
                </Badge>
                <Badge tone={getUpdateTone(updateState.status)} dot>
                  {getUpdateStatusLabel(updateState.status, t)}
                </Badge>
              </div>
            )}
            open={openSettingsSection === 'updates'}
            onToggle={() => toggleSettingsSection('updates')}
          >
            <div className="rounded-xl border border-border bg-card p-3">
              <label className="space-y-2">
                <span className="text-xs text-muted-foreground">{t('updates.channel.label')}</span>
                <Select
                  value={updateState.channel}
                  onValueChange={(value) => void changeUpdateChannel(value as UpdateChannel)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stable">{t('updates.channel.stable')}</SelectItem>
                    <SelectItem value="ea">{t('updates.channel.ea')}</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {updateState.channel === 'ea' ? t('updates.channel.helper_ea') : t('updates.channel.helper_stable')}
                </p>
              </label>
            </div>

            <p className="mt-3 text-xs text-muted-foreground">{getUpdateSummary(updateState, t)}</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Badge>{t('updates.current', { version: updateState.currentVersion })}</Badge>
              {updateState.availableVersion && updateState.availableVersion !== updateState.currentVersion && (
                <Badge tone="accent">{t('updates.latest', { version: updateState.availableVersion })}</Badge>
              )}
              {updateState.checkedAt && (
                <Badge tone="unchanged">
                  {t('updates.checked', { date: new Date(updateState.checkedAt).toLocaleString(locale) })}
                </Badge>
              )}
            </div>

            {updateState.progress && updateState.status === 'downloading' && (
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.max(4, Math.min(100, updateState.progress.percent))}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {t('updates.speed', {
                    percent: updateState.progress.percent.toFixed(0),
                    speed: formatBytes(updateState.progress.bytesPerSecond),
                  })}
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={updateAction !== 'idle' || updateState.status === 'disabled'}
                onClick={() => void checkForUpdates()}
              >
                <RefreshCcw className={cn('h-3.5 w-3.5', updateAction === 'checking' && 'animate-spin')} />
                {t('updates.check_now')}
              </Button>
              <Button
                size="sm"
                disabled={
                  updateState.manualDownloadOnly
                    ? updateState.status !== 'available' || updateAction === 'installing'
                    : updateState.status !== 'downloaded' || updateAction === 'installing'
                }
                onClick={() => void (updateState.manualDownloadOnly ? openUpdateDownload() : installUpdate())}
              >
                {updateState.manualDownloadOnly ? (
                  <ExternalLink className="h-3.5 w-3.5" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                {updateState.manualDownloadOnly ? t('updates.download') : t('updates.restart_install')}
              </Button>
            </div>
          </SettingsSection>
          <SettingsSection
            title={t('settings.language')}
            badge={<Badge tone="accent">{AVAILABLE_LOCALES.find((option) => option.code === locale)?.nativeLabel ?? locale}</Badge>}
            open={openSettingsSection === 'language'}
            onToggle={() => toggleSettingsSection('language')}
          >
            <div className="rounded-xl border border-border bg-card p-3">
              <label className="space-y-2">
                <span className="text-xs text-muted-foreground">{t('locale.label')}</span>
                <Select value={locale} onValueChange={(value) => setLocale(value as AppLocale)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AVAILABLE_LOCALES.map((option) => (
                      <SelectItem key={option.code} value={option.code}>
                        {option.nativeLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('locale.helper')}</p>
              </label>
            </div>
          </SettingsSection>
          <SettingsSection
            title={t('settings.appearance')}
            badge={<Badge tone="accent">{theme.name}</Badge>}
            open={openSettingsSection === 'appearance'}
            onToggle={() => toggleSettingsSection('appearance')}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('updates.theme_library')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('updates.theme_library_help')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={cycleTheme}>
                    <Palette className="h-3.5 w-3.5" />
                    {t('appearance.cycle')}
                  </Button>
                  <Button size="sm" onClick={createThemeFromActive}>
                    <Plus className="h-3.5 w-3.5" />
                    {t('appearance.new_custom')}
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {themes.map((candidate) => (
                  <ThemeOptionCard
                    key={candidate.id}
                    theme={candidate}
                    active={candidate.id === theme.id}
                    onSelect={() => setTheme(candidate.id)}
                    onDuplicate={() => createThemeFromId(candidate.id)}
                  />
                ))}
              </div>

              {activeCustomTheme ? (
                <div className="space-y-4 rounded-xl border border-border bg-surface/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{t('appearance.edit_custom')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{t('appearance.edit_help')}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => deleteCustomTheme(activeCustomTheme.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('appearance.delete_custom')}
                    </Button>
                  </div>

                  <label className="space-y-2">
                    <span className="text-xs text-muted-foreground">{t('appearance.theme_name')}</span>
                    <Input
                      value={activeCustomTheme.name}
                      onChange={(event) => renameCustomTheme(activeCustomTheme.id, event.target.value)}
                      onBlur={(event) => {
                        const nextName = event.target.value.trim() || t('appearance.theme_name_placeholder');
                        if (nextName !== activeCustomTheme.name) {
                          renameCustomTheme(activeCustomTheme.id, nextName);
                        }
                      }}
                      placeholder={t('appearance.theme_name_placeholder')}
                    />
                  </label>

                  <div className="grid gap-3 lg:grid-cols-2">
                    {THEME_TOKEN_FIELDS.map((field) => (
                      <ThemeTokenEditor
                        key={field.key}
                        label={t(`theme.token.${field.key}.label`)}
                        description={t(`theme.token.${field.key}.description`)}
                        value={activeCustomTheme.tokens[field.key]}
                        onChange={(value) => updateCustomThemeToken(activeCustomTheme.id, field.key, value)}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-card/70 p-4">
                  <p className="text-sm font-semibold text-foreground">{t('appearance.editor_title')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('appearance.editor_help')}</p>
                </div>
              )}
            </div>
          </SettingsSection>
          <SettingsSection
            title={t('settings.platform_rules')}
            open={openSettingsSection === 'platformRules'}
            onToggle={() => toggleSettingsSection('platformRules')}
          >
            <p className="text-xs text-muted-foreground">{t('platform_rules.description', { platform })}</p>
          </SettingsSection>
          <SettingsSection
            title={t('settings.execution_profile')}
            open={openSettingsSection === 'executionProfile'}
            onToggle={() => toggleSettingsSection('executionProfile')}
          >
            <p className="text-xs text-muted-foreground">{t('execution_profile.description')}</p>
          </SettingsSection>
        </div>
      </Drawer>

      <ToastProvider swipeDirection="right">
        {updateToast && (
          <Toast
            key={updateToast.id}
            open={updateToast.open}
            onOpenChange={(open) => {
              setUpdateToast((current) => (current ? { ...current, open } : current));
            }}
            tone={updateToast.tone}
            duration={updateToast.actionKind === 'install-update' ? 12000 : 7000}
          >
            <div className="pr-8">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                    updateToast.tone === 'ok' && 'bg-ok/15 text-ok',
                    updateToast.tone === 'accent' && 'bg-accent/15 text-accent',
                    updateToast.tone === 'conflict' && 'bg-conflict/15 text-conflict',
                    updateToast.tone === 'default' && 'bg-surface text-foreground',
                  )}
                >
                  {updateToast.tone === 'ok' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : updateToast.tone === 'conflict' ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : updateToast.actionKind === 'install-update' ? (
                    <Download className="h-4 w-4" />
                  ) : (
                    <Info className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <ToastTitle>{updateToast.title}</ToastTitle>
                  <ToastDescription>{updateToast.description}</ToastDescription>
                </div>
              </div>
              {updateToast.actionLabel && (
                <div className="mt-3 flex justify-end">
                  <ToastAction
                    altText={updateToast.actionLabel}
                    onClick={() => handleUpdateToastAction(updateToast.actionKind)}
                  >
                    {updateToast.actionLabel}
                  </ToastAction>
                </div>
              )}
            </div>
            <ToastClose />
          </Toast>
        )}
        <ToastViewport />
      </ToastProvider>
    </div>
  );
}
