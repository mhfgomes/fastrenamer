import { z } from 'zod';
import type {
  DirectoryListing,
  ExecuteRenameBatchResult,
  HistoryEntry,
  PickSourcesRequest,
  PlatformTarget,
  Preset,
  PreviewRequest,
  PreviewResult,
  RenameRule,
  SortMode,
  SourceMode,
  SourceSelection,
  UndoRenameBatchRequest,
  UndoRenameBatchResult,
} from '@fastrenamer/rename-engine';

const baseRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  label: z.string().optional(),
});

const renameRuleSchema = z.discriminatedUnion('type', [
  baseRuleSchema.extend({
    type: z.literal('new_name'),
    template: z.string(),
    reverseSequence: z.boolean().optional(),
  }),
  baseRuleSchema.extend({
    type: z.literal('custom_rule'),
    expression: z.string(),
  }),
  baseRuleSchema.extend({
    type: z.literal('find_replace'),
    find: z.string(),
    replace: z.string(),
    matchCase: z.boolean(),
    useRegex: z.boolean(),
    replaceAll: z.boolean(),
  }),
  baseRuleSchema.extend({
    type: z.literal('prefix_suffix'),
    prefix: z.string(),
    suffix: z.string(),
  }),
  baseRuleSchema.extend({
    type: z.literal('case_transform'),
    mode: z.enum(['lower', 'upper', 'title', 'sentence', 'camel', 'pascal', 'kebab', 'snake']),
  }),
  baseRuleSchema.extend({
    type: z.literal('trim_text'),
    mode: z.enum([
      'trim',
      'trim_start',
      'trim_end',
      'collapse_spaces',
      'remove_spaces',
      'remove_dashes',
      'remove_underscores',
    ]),
  }),
  baseRuleSchema.extend({
    type: z.literal('remove_text'),
    text: z.string(),
    matchCase: z.boolean(),
  }),
  baseRuleSchema.extend({
    type: z.literal('sequence_insert'),
    position: z.enum(['prefix', 'suffix', 'before_extension']),
    start: z.number().int(),
    step: z.number().int(),
    padWidth: z.number().int().min(0),
    separator: z.string(),
  }),
  baseRuleSchema.extend({
    type: z.literal('letter_sequence_insert'),
    position: z.enum(['prefix', 'suffix', 'before_extension']),
    start: z.number().int().min(1),
    step: z.number().int().min(1),
    casing: z.enum(['upper', 'lower']),
    separator: z.string(),
  }),
  baseRuleSchema.extend({
    type: z.literal('date_time'),
    position: z.enum(['prefix', 'suffix', 'before_extension']),
    format: z.string(),
    separator: z.string(),
  }),
  baseRuleSchema.extend({
    type: z.literal('extension_handling'),
    mode: z.enum(['keep', 'lowercase', 'uppercase', 'replace', 'remove']),
    replacement: z.string(),
  }),
]);

const platformSchema = z.enum(['darwin', 'win32', 'linux']) satisfies z.ZodType<PlatformTarget>;
const sourceModeSchema = z.enum([
  'picked_folders',
  'picked_files',
  'top_level_folders',
  'subfolders',
  'top_level_files',
  'files_recursive',
]) satisfies z.ZodType<SourceMode>;
const sortModeSchema = z.enum([
  'natural_path',
  'alphabetic_path',
  'name_only',
  'folder_then_name',
]) satisfies z.ZodType<SortMode>;

export const pickSourcesRequestSchema = z.object({
  mode: sourceModeSchema,
}) satisfies z.ZodType<PickSourcesRequest>;

const WINDOWS_ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/;

/**
 * Pure (no node:path) absolute-path check so this module stays renderer-safe.
 * On Windows a drive-letter or UNC path is required; elsewhere a leading `/`.
 */
export function isAbsolutePathForPlatform(value: string, platform: string) {
  return platform === 'win32' ? WINDOWS_ABSOLUTE_PATH.test(value) : value.startsWith('/');
}

const runtimePlatform = (globalThis as { process?: { platform?: string } }).process?.platform;

const absolutePathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.includes('\0'), 'Path must not contain NUL bytes.')
  .refine(
    (value) =>
      runtimePlatform
        ? isAbsolutePathForPlatform(value, runtimePlatform)
        : isAbsolutePathForPlatform(value, 'win32') || isAbsolutePathForPlatform(value, 'posix'),
    'Path must be absolute.',
  );

/**
 * Preview request sent by the renderer. `platform` is accepted for backwards compatibility but
 * ignored: the main process always plans for `process.platform`.
 */
export const previewRequestSchema = z.object({
  sourcePaths: z.array(absolutePathSchema),
  sourceMode: sourceModeSchema,
  fileNamePattern: z.string(),
  sortMode: sortModeSchema,
  rules: z.array(renameRuleSchema),
  platform: platformSchema.optional(),
  /** Include dotfiles / dot-directories (e.g. `.git`) when walking folders. Defaults to false. */
  includeHidden: z.boolean().optional(),
});

export type AppPreviewRequest = z.infer<typeof previewRequestSchema>;

/** SHA-256 hex digest identifying an approved plan (see `AppPreviewResult.planId`). */
export const planIdSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Execute = the preview request plus the `planId` of the preview the user approved. */
export const executeRenameBatchRequestSchema = previewRequestSchema.extend({
  planId: planIdSchema,
});

export type AppExecuteRenameBatchRequest = z.infer<typeof executeRenameBatchRequestSchema>;

export const undoRenameBatchRequestSchema = z.object({
  batchId: z.number().int().positive(),
}) satisfies z.ZodType<UndoRenameBatchRequest>;

export const pathListRequestSchema = z.array(absolutePathSchema).min(1);

export const savePresetRequestSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1),
  rules: z.array(renameRuleSchema),
});

/** Rename-only update of a user preset; its rules are left untouched. */
export const renamePresetRequestSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
});

export const deletePresetRequestSchema = z.number().int().positive();
export const exportPresetRequestSchema = z.number().int().positive();

export const sourceSelectionSchema = z.object({
  path: z.string(),
  name: z.string(),
  parentPath: z.string(),
  isDirectory: z.boolean(),
}) satisfies z.ZodType<SourceSelection>;

export const directoryListingSchema = z.object({
  sourcePath: z.string(),
  directChildren: z.number().int(),
  recursiveChildren: z.number().int(),
  items: z.array(sourceSelectionSchema),
  skippedDirectories: z.number().int(),
  recursiveChildrenTruncated: z.boolean(),
}) satisfies z.ZodType<AppDirectoryListing>;

export const presetSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  isSample: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  rules: z.array(renameRuleSchema),
}) satisfies z.ZodType<Preset>;

export const presetTransferEntrySchema = z.object({
  name: z.string().trim().min(1),
  rules: z.array(renameRuleSchema),
});

export const presetTransferFileSchema = z.object({
  app: z.literal('Fast Renamer').optional(),
  version: z.number().int().positive().optional(),
  exportedAt: z.string().optional(),
  presets: z.array(presetTransferEntrySchema),
});

export const presetImportFileSchema = z.union([
  presetTransferFileSchema,
  z.array(presetTransferEntrySchema),
]);

export type PresetTransferEntry = z.infer<typeof presetTransferEntrySchema>;

export const historyEntrySchema = z.object({
  id: z.number().int(),
  createdAt: z.string(),
  renamedCount: z.number().int(),
  sourceRoots: z.array(z.string()),
  rules: z.array(renameRuleSchema),
  previewSummary: z.object({
    total: z.number().int(),
    changed: z.number().int(),
    ok: z.number().int(),
    conflict: z.number().int(),
    invalid: z.number().int(),
    unchanged: z.number().int(),
    blocked: z.boolean(),
  }),
  canUndo: z.boolean(),
  undoState: z.enum(['ready', 'archived', 'overlap', 'missing', 'occupied']),
  undoReason: z.string().optional(),
}) satisfies z.ZodType<HistoryEntry>;

/** Directory listing with the folders that could not be read (EPERM/EACCES/...) counted, not fatal. */
export interface AppDirectoryListing extends DirectoryListing {
  skippedDirectories: number;
  /** `recursiveChildren` stopped counting at the scan cap; treat it as "at least". */
  recursiveChildrenTruncated: boolean;
}

export interface AppPreviewResult extends PreviewResult {
  /**
   * Identity of this plan: SHA-256 over the ordered (sourcePath, nextPath, isDirectory) list of
   * changed rows plus `summary.blocked`. Send it back with execute so main can refuse to run a
   * plan that differs from the one the user approved.
   */
  planId: string;
  /** Folders skipped while collecting items because they could not be read. */
  skippedDirectories: number;
}

export interface AppExecuteRenameBatchResult extends ExecuteRenameBatchResult {
  planId: string;
  skippedDirectories: number;
  /** True when execution was refused because the regenerated plan differs from `request.planId`. */
  planChanged: boolean;
  /**
   * Non-fatal problems after files were renamed (e.g. history could not be recorded). Files WERE
   * renamed when `renamedCount > 0` even if this is non-empty.
   */
  warnings: string[];
  historyRecorded: boolean;
}

export interface AppUndoRenameBatchResult extends UndoRenameBatchResult {
  /** Non-fatal problems after files were restored (e.g. the batch could not be marked undone). */
  warnings: string[];
}

/** Startup messages (database reset, interrupted-rename recovery, ...) for the renderer to show. */
export interface StartupNotice {
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface WindowState {
  isMaximized: boolean;
}

export interface UpdateProgress {
  bytesPerSecond: number;
  percent: number;
  transferred: number;
  total: number;
}

export type UpdateStatus =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'installing'
  | 'error';

export type UpdateChannel = 'stable' | 'ea';

/** Why this build can only check for updates and must download new versions manually. */
export type UpdateManualReason =
  /** macOS: `codesign` could not verify the app bundle. */
  | 'mac-signature-unverified'
  /** macOS: the bundle is not Developer ID-signed (ad-hoc or unsigned). */
  | 'mac-unsigned'
  /** Windows portable executable (no installer to update in place). */
  | 'windows-portable';

/**
 * Machine-readable reason behind a non-automatic update state; the renderer translates it.
 * `not-packaged` accompanies the `disabled` status (dev / unpackaged runs).
 */
export type UpdateReason = UpdateManualReason | 'not-packaged';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  channel: UpdateChannel;
  availableVersion?: string;
  releaseDate?: string;
  releaseName?: string;
  checkedAt?: string;
  progress?: UpdateProgress;
  /** Free-form (untranslated) error text from electron-updater; only set for `error`. */
  message?: string;
  reason?: UpdateReason;
  manualDownloadOnly?: boolean;
  downloadUrl?: string;
}

export interface AdvancedRenamerApi {
  getDroppedPaths(files: File[]): string[];
  pickSources(request: PickSourcesRequest): Promise<SourceSelection[]>;
  resolveSources(paths: string[]): Promise<SourceSelection[]>;
  loadDirectoryItems(paths: string[]): Promise<AppDirectoryListing[]>;
  generatePreview(request: AppPreviewRequest): Promise<AppPreviewResult>;
  executeRenameBatch(request: AppExecuteRenameBatchRequest): Promise<AppExecuteRenameBatchResult>;
  undoRenameBatch(request: UndoRenameBatchRequest): Promise<AppUndoRenameBatchResult>;
  getStartupNotices(): Promise<StartupNotice[]>;
  listPresets(): Promise<Preset[]>;
  savePreset(input: { id?: number; name: string; rules: RenameRule[] }): Promise<Preset>;
  renamePreset(input: { id: number; name: string }): Promise<Preset>;
  deletePreset(id: number): Promise<void>;
  exportUserPresets(): Promise<{ canceled: boolean; exportedCount: number }>;
  exportUserPreset(id: number): Promise<{ canceled: boolean; exportedCount: number }>;
  importUserPresets(): Promise<{ canceled: boolean; importedCount: number }>;
  listHistory(): Promise<HistoryEntry[]>;
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<WindowState>;
  closeWindow(): Promise<void>;
  getWindowState(): Promise<WindowState>;
  onWindowStateChanged(listener: (state: WindowState) => void): () => void;
  getUpdateState(): Promise<UpdateState>;
  getUpdateChannel(): Promise<UpdateChannel>;
  setUpdateChannel(channel: UpdateChannel): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  quitAndInstallUpdate(): Promise<boolean>;
  openUpdateDownload(): Promise<boolean>;
  onUpdateStateChanged(listener: (state: UpdateState) => void): () => void;
}

export type {
  ExecuteRenameBatchResult,
  HistoryEntry,
  PickSourcesRequest,
  Preset,
  PreviewRequest,
  PreviewResult,
  RenameRule,
  SourceMode,
  UndoRenameBatchRequest,
  UndoRenameBatchResult,
};
