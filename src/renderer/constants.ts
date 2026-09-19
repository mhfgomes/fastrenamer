import type { SortMode } from '@fast-renamer/rename-engine';

export const APP_VERSION = __APP_VERSION__;

export const SORT_MODE_OPTIONS: SortMode[] = [
  'natural_path',
  'alphabetic_path',
  'name_only',
  'folder_then_name',
];
