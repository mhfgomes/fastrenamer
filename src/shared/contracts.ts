import { z } from 'zod';
import type {
  DirectoryListing,
  ExecuteRenameBatchRequest,
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
} from '@fast-renamer/rename-engine';

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

export const previewRequestSchema = z.object({
  sourcePaths: z.array(z.string().min(1)),
  sourceMode: sourceModeSchema,
  fileNamePattern: z.string(),
  sortMode: sortModeSchema,
  rules: z.array(renameRuleSchema),
  platform: platformSchema,
}) satisfies z.ZodType<PreviewRequest>;

export const executeRenameBatchRequestSchema =
  previewRequestSchema satisfies z.ZodType<ExecuteRenameBatchRequest>;

export const undoRenameBatchRequestSchema = z.object({
  batchId: z.number().int().positive(),
}) satisfies z.ZodType<UndoRenameBatchRequest>;

export const pathListRequestSchema = z.array(z.string().min(1)).min(1);

export const savePresetRequestSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1),
  rules: z.array(renameRuleSchema),
});

export const deletePresetRequestSchema = z.number().int().positive();

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
}) satisfies z.ZodType<DirectoryListing>;

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

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  channel: UpdateChannel;
  availableVersion?: string;
  releaseDate?: string;
  releaseName?: string;
  checkedAt?: string;
  progress?: UpdateProgress;
  message?: string;
  manualDownloadOnly?: boolean;
  downloadUrl?: string;
}

export interface AdvancedRenamerApi {
  getDroppedPaths(files: File[]): string[];
  pickSources(request: PickSourcesRequest): Promise<SourceSelection[]>;
  resolveSources(paths: string[]): Promise<SourceSelection[]>;
  loadDirectoryItems(paths: string[]): Promise<DirectoryListing[]>;
  generatePreview(request: PreviewRequest): Promise<PreviewResult>;
  executeRenameBatch(request: ExecuteRenameBatchRequest): Promise<ExecuteRenameBatchResult>;
  undoRenameBatch(request: UndoRenameBatchRequest): Promise<UndoRenameBatchResult>;
  listPresets(): Promise<Preset[]>;
  savePreset(input: { id?: number; name: string; rules: RenameRule[] }): Promise<Preset>;
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
  ExecuteRenameBatchRequest,
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
