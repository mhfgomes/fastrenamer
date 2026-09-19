import type { PreviewResult } from '@fast-renamer/rename-engine/types';
import type { SourceMode, RenameRule } from '@fast-renamer/rename-engine/types';
import type { UpdateState, WindowState } from '@shared/contracts';

export const DEFAULT_PREVIEW: PreviewResult = {
  rows: [],
  summary: { total: 0, changed: 0, ok: 0, conflict: 0, invalid: 0, unchanged: 0, blocked: false },
};

export const STATUS_OPTIONS = ['ok', 'conflict', 'invalid', 'unchanged'] as const;

export const SOURCE_MODE_OPTIONS: SourceMode[] = [
  'picked_folders',
  'picked_files',
  'top_level_folders',
  'subfolders',
  'top_level_files',
  'files_recursive',
];

export const RULE_TYPE_ORDER: RenameRule['type'][] = [
  'new_name',
  'custom_rule',
  'find_replace',
  'prefix_suffix',
  'case_transform',
  'trim_text',
  'remove_text',
  'sequence_insert',
  'letter_sequence_insert',
  'date_time',
  'extension_handling',
];

export const CUSTOM_RULE_HELPERS = [
  'lower(text)',
  'upper(text)',
  'trim(text)',
  'title(text)',
  'camel(text)',
  'pascal(text)',
  'kebab(text)',
  'snake(text)',
  'replace(text, search, replacement)',
  'replaceAll(text, search, replacement)',
  'regexReplace(text, pattern, replacement, flags)',
  'pad(value, width, fill?)',
  'slice(text, start, end?)',
  'startsWith(text, search)',
  'endsWith(text, search)',
  'includes(text, search)',
  'basename(path)',
  'dirname(path)',
  'len(text)',
  'when(condition, yes, no)',
  'ext(value)',
] as const;

export const LEFT_WIDTH_STORAGE_KEY = 'left_panel_width';
export const SORT_MODE_STORAGE_KEY = 'source_sort_mode';
export const DEFAULT_LEFT_WIDTH_RATIO = 0.28;
export const MAX_LEFT_WIDTH_RATIO = 0.45;
export const MIN_LEFT_PANEL_WIDTH_PX = 453;
export const MIN_PREVIEW_PANEL_WIDTH_PX = 320;

export const DEFAULT_WINDOW_STATE: WindowState = {
  isMaximized: false,
};

export const DEFAULT_UPDATE_STATE: UpdateState = {
  status: 'idle',
  currentVersion: '0.0.0',
  channel: 'stable',
};

type UpdateToastTone = 'default' | 'ok' | 'accent' | 'conflict';

interface UpdateToastState {
  id: number;
  open: boolean;
  tone: UpdateToastTone;
  title: string;
  description: string;
  actionLabel?: string;
  actionKind?: 'open-settings' | 'install-update' | 'download-update';
}


export type StatusFilter = (typeof STATUS_OPTIONS)[number];
