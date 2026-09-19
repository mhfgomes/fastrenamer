import type { DragEvent } from 'react';
import type { PlatformTarget, SortMode, SourceMode, SourceSelection } from '@fast-renamer/rename-engine/types';
import { sortItemsByMode } from '@fast-renamer/rename-engine/sort';
import type { useI18n } from '../i18n';

export function getSourceModeMeta(t: ReturnType<typeof useI18n>['t']): Record<
  SourceMode,
  { label: string; pickerLabel: string; detail: string; supportsFilter: boolean }
> {
  return {
    picked_folders: {
      label: t('source.mode.picked_folders.label'),
      pickerLabel: t('source.mode.picked_folders.picker'),
      detail: t('source.mode.picked_folders.detail'),
      supportsFilter: false,
    },
    picked_files: {
      label: t('source.mode.picked_files.label'),
      pickerLabel: t('source.mode.picked_files.picker'),
      detail: t('source.mode.picked_files.detail'),
      supportsFilter: true,
    },
    top_level_folders: {
      label: t('source.mode.top_level_folders.label'),
      pickerLabel: t('source.mode.top_level_folders.picker'),
      detail: t('source.mode.top_level_folders.detail'),
      supportsFilter: false,
    },
    subfolders: {
      label: t('source.mode.subfolders.label'),
      pickerLabel: t('source.mode.subfolders.picker'),
      detail: t('source.mode.subfolders.detail'),
      supportsFilter: false,
    },
    top_level_files: {
      label: t('source.mode.top_level_files.label'),
      pickerLabel: t('source.mode.top_level_files.picker'),
      detail: t('source.mode.top_level_files.detail'),
      supportsFilter: true,
    },
    files_recursive: {
      label: t('source.mode.files_recursive.label'),
      pickerLabel: t('source.mode.files_recursive.picker'),
      detail: t('source.mode.files_recursive.detail'),
      supportsFilter: true,
    },
  };
}

export function getSortModeMeta(t: ReturnType<typeof useI18n>['t']): Record<SortMode, { label: string }> {
  return {
    natural_path: { label: t('sources.sort_mode.natural_path') },
    alphabetic_path: { label: t('sources.sort_mode.alphabetic_path') },
    name_only: { label: t('sources.sort_mode.name_only') },
    folder_then_name: { label: t('sources.sort_mode.folder_then_name') },
  };
}

export function detectPlatform(): PlatformTarget {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'win32';
  if (ua.includes('mac')) return 'darwin';
  return 'linux';
}

export function isFileDropEvent(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

export function sortSourceSelections(sources: SourceSelection[], sortMode: SortMode) {
  return sortItemsByMode(sources, sortMode);
}

export function getSelectedLabel(sources: SourceSelection[], t: ReturnType<typeof useI18n>['t']) {
  if (sources.length === 0) {
    return t('selected.none');
  }

  if (sources.every((source) => source.isDirectory)) {
    return t('selected.folders', { count: sources.length });
  }

  if (sources.every((source) => !source.isDirectory)) {
    return t('selected.files', { count: sources.length });
  }

  return t('selected.items', { count: sources.length });
}

export function getAvailableSourceModes(sources: SourceSelection[]): SourceMode[] {
  const hasFiles = sources.some((source) => !source.isDirectory);
  const hasDirectories = sources.some((source) => source.isDirectory);
  const modes: SourceMode[] = [];

  if (hasFiles) {
    modes.push('picked_files');
  }
  if (hasDirectories) {
    modes.push('picked_folders', 'top_level_folders', 'subfolders', 'top_level_files', 'files_recursive');
  }

  return modes;
}
