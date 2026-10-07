import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { SortMode, SourceMode, SourceSelection } from '@fastrenamer/rename-engine/types';
import { SORT_MODE_STORAGE_KEY, SOURCE_MODE_OPTIONS } from '../app/defaults';
import { getErrorMessage } from '../app/ipc-errors';
import { getAvailableSourceModes, getSourceModeMeta, isFileDropEvent, sortSourceSelections } from '../app/source-meta';

import type { Translate } from '../i18n';

function readStoredSortMode(): SortMode {
  const stored = localStorage.getItem(SORT_MODE_STORAGE_KEY);
  return stored === 'natural_path' ||
    stored === 'alphabetic_path' ||
    stored === 'name_only' ||
    stored === 'folder_then_name'
    ? stored
    : 'natural_path';
}

/**
 * Source roots, mode/filter/sort, the "Add sources" dialog drafts, the native picker and drops.
 * While locked (a rename/undo is running) every source change is ignored.
 */
export function useSourceSelection({
  t,
  isLocked,
  onError,
}: {
  t: Translate;
  /** True while a rename/undo runs; read at event time so it is never stale. */
  isLocked: () => boolean;
  onError: (message: string | null) => void;
}) {
  const sourceModeMeta = useMemo(() => getSourceModeMeta(t), [t]);
  const [sources, setSources] = useState<SourceSelection[]>([]);
  const [sourceMode, setSourceMode] = useState<SourceMode>('picked_files');
  const [fileNamePattern, setFileNamePattern] = useState('');
  const [sortMode, setSortModeState] = useState<SortMode>(readStoredSortMode);
  const [addSourcesOpen, setAddSourcesOpen] = useState(false);
  const [draftSourceMode, setDraftSourceMode] = useState<SourceMode>(sourceMode);
  const [draftFileNamePattern, setDraftFileNamePattern] = useState(fileNamePattern);
  const [draftSortMode, setDraftSortMode] = useState<SortMode>(sortMode);
  const [pendingSourcePick, setPendingSourcePick] = useState<{
    mode: SourceMode;
    fileNamePattern: string;
    sortMode: SortMode;
  } | null>(null);
  const [pendingDroppedSources, setPendingDroppedSources] = useState<SourceSelection[] | null>(null);

  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    localStorage.setItem(SORT_MODE_STORAGE_KEY, sortMode);
    setSources((current) => sortSourceSelections(current, sortMode));
  }, [sortMode]);

  // The native picker opens only after the dialog has closed (so it does not fight Radix's focus trap).
  useEffect(() => {
    if (addSourcesOpen || !pendingSourcePick) {
      return;
    }

    const nextPick = pendingSourcePick;
    setPendingSourcePick(null);

    void (async () => {
      try {
        const picked = await window.advancedRenamer.pickSources({ mode: nextPick.mode });
        // Cancelled (or nothing usable picked): keep the current sources, mode, filter and sort.
        if (picked.length === 0 || isLockedRef.current()) {
          return;
        }
        onErrorRef.current(null);
        setSourceMode(nextPick.mode);
        setFileNamePattern(nextPick.fileNamePattern);
        setSortModeState(nextPick.sortMode);
        setSources(sortSourceSelections(picked, nextPick.sortMode));
      } catch (error) {
        onErrorRef.current(getErrorMessage(error, t('error.source_picker')));
      }
    })();
  }, [addSourcesOpen, pendingSourcePick, t]);

  const setSortMode = useCallback((mode: SortMode) => {
    if (!isLockedRef.current()) setSortModeState(mode);
  }, []);

  const clearSources = useCallback(() => {
    if (isLockedRef.current()) return;
    setSources([]);
    setPendingSourcePick(null);
    onErrorRef.current(null);
  }, []);

  /** Clears sources after a successful rename (bypasses the lock, which is still held then). */
  const resetSources = useCallback(() => {
    setSources([]);
    setPendingSourcePick(null);
  }, []);

  const openAddSources = useCallback(() => {
    if (isLockedRef.current()) return;
    setPendingDroppedSources(null);
    setDraftSourceMode(sourceMode);
    setDraftFileNamePattern(fileNamePattern);
    setDraftSortMode(sortMode);
    setAddSourcesOpen(true);
  }, [fileNamePattern, sortMode, sourceMode]);

  function onDialogOpenChange(open: boolean) {
    setAddSourcesOpen(open);
    if (!open) {
      setPendingDroppedSources(null);
    }
  }

  function onDraftSourceModeChange(nextMode: SourceMode) {
    setDraftSourceMode(nextMode);
    if (!sourceModeMeta[nextMode].supportsFilter) {
      setDraftFileNamePattern('');
    }
  }

  function confirmDialog() {
    if (isLockedRef.current()) return;
    if (pendingDroppedSources) {
      const nextSources =
        draftSourceMode === 'picked_files'
          ? pendingDroppedSources.filter((source) => !source.isDirectory)
          : pendingDroppedSources.filter((source) => source.isDirectory);

      if (nextSources.length === 0) {
        onErrorRef.current(t('error.dropped_mode'));
        return;
      }

      onErrorRef.current(null);
      setSourceMode(draftSourceMode);
      setFileNamePattern(draftFileNamePattern);
      setSortModeState(draftSortMode);
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

  function removeSource(sourcePath: string) {
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
        onDraftSourceModeChange(
          availableModes.includes('files_recursive') ? 'files_recursive' : availableModes[0],
        );
      }
      return;
    }

    if (isLockedRef.current()) return;
    setSources((current) => sortSourceSelections(current.filter((source) => source.path !== sourcePath), sortMode));
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();

    if (!isFileDropEvent(event) || isLockedRef.current()) {
      return;
    }

    const droppedPaths = window.advancedRenamer.getDroppedPaths(Array.from(event.dataTransfer.files));

    if (droppedPaths.length === 0) {
      onErrorRef.current(t('error.dropped_paths'));
      return;
    }

    try {
      onErrorRef.current(null);
      const resolved = await window.advancedRenamer.resolveSources(droppedPaths);
      if (isLockedRef.current()) return;
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
    } catch (error) {
      onErrorRef.current(getErrorMessage(error, t('error.read_dropped')));
    }
  }

  const dialogItems = useMemo(
    () => sortSourceSelections(pendingDroppedSources ?? sources, draftSortMode),
    [draftSortMode, pendingDroppedSources, sources],
  );

  return {
    sources,
    sourceMode,
    fileNamePattern,
    sortMode,
    setSortMode,
    clearSources,
    resetSources,
    openAddSources,
    handleDrop,
    dialog: {
      open: addSourcesOpen,
      onOpenChange: onDialogOpenChange,
      isDrop: pendingDroppedSources !== null,
      items: dialogItems,
      rootCount: pendingDroppedSources?.length ?? sources.length,
      availableModes: pendingDroppedSources ? getAvailableSourceModes(pendingDroppedSources) : SOURCE_MODE_OPTIONS,
      draftSourceMode,
      draftFileNamePattern,
      draftSortMode,
      onDraftSourceModeChange,
      onDraftFileNamePatternChange: setDraftFileNamePattern,
      onDraftSortModeChange: setDraftSortMode,
      onRemoveSource: removeSource,
      onConfirm: confirmDialog,
    },
  };
}

export type AddSourcesDialogState = ReturnType<typeof useSourceSelection>['dialog'];
