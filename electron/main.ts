import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { compareNatural } from '@fastrenamer/rename-engine';
import type { IpcMainInvokeEvent, OpenDialogOptions, SaveDialogOptions } from 'electron';
import {
  pickSourcesRequestSchema,
  executeRenameBatchRequestSchema,
  presetImportFileSchema,
  previewRequestSchema,
  undoRenameBatchRequestSchema,
  pathListRequestSchema,
  savePresetRequestSchema,
  renamePresetRequestSchema,
  deletePresetRequestSchema,
} from '../src/shared/contracts';
import type { PresetTransferEntry } from '../src/shared/contracts';
import type { AppPreviewRequest, StartupNotice } from '../src/shared/contracts';
import { AppDatabase, DatabaseVersionError, openAppDatabase } from './db';
import {
  createLatestPreviewRunner,
  executeRenameBatch,
  listHistoryWithUndoStatus,
  loadDirectoryListing,
  pickableSource,
  undoRenameBatch,
} from './rename-service';
import type { ServicePreviewRequest } from './rename-service';
import { createWorkerPlanner } from './preview-worker-client';
import { recoverInterruptedRenames } from './rename-journal';
import { AppUpdaterManager } from './updater';

let mainWindow: BrowserWindow | null = null;
let database: AppDatabase;
let updater: AppUpdaterManager;
const mainDir = path.dirname(fileURLToPath(import.meta.url));

const getPlatform = () => process.platform as 'darwin' | 'win32' | 'linux';
const startupNotices: StartupNotice[] = [];
const previewPlanner = createWorkerPlanner(path.join(mainDir, 'preview-worker.js'));
const runLatestPreview = createLatestPreviewRunner(previewPlanner);

// The renderer's `platform` field is ignored: planning always uses the host platform.
function toServiceRequest(request: AppPreviewRequest): ServicePreviewRequest {
  return {
    sourcePaths: request.sourcePaths,
    sourceMode: request.sourceMode,
    fileNamePattern: request.fileNamePattern,
    sortMode: request.sortMode,
    rules: request.rules,
    includeHidden: request.includeHidden ?? false,
    platform: getPlatform(),
  };
}
const DEFAULT_WINDOW_STATE = { isMaximized: false };
const PRESET_TRANSFER_VERSION = 1;

function serializeWindowState(window: BrowserWindow) {
  return { isMaximized: window.isMaximized() };
}

function emitWindowState(window: BrowserWindow) {
  window.webContents.send('window:stateChanged', serializeWindowState(window));
}

function getDialogWindow(event: IpcMainInvokeEvent) {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow ?? undefined;
}

function normalizePresetImportPayload(payload: unknown) {
  const parsed = presetImportFileSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error('The selected file is not a valid Fast Renamer presets export.');
  }

  return Array.isArray(parsed.data) ? parsed.data : parsed.data.presets;
}

function sanitizeExportFilename(name: string) {
  const sanitized = name
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  return sanitized || 'preset';
}

function createPresetTransferFile(presets: PresetTransferEntry[]) {
  return {
    app: 'Fast Renamer',
    version: PRESET_TRANSFER_VERSION,
    exportedAt: new Date().toISOString(),
    presets,
  };
}

function showSavePresetDialog(event: IpcMainInvokeEvent, defaultFilename = 'fast-renamer-presets.json') {
  const options: SaveDialogOptions = {
    title: 'Export Presets',
    defaultPath: path.join(app.getPath('documents'), defaultFilename),
    filters: [{ name: 'Fast Renamer Presets', extensions: ['json'] }],
  };
  const window = getDialogWindow(event);

  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options);
}

async function exportPresetTransferFile(
  event: IpcMainInvokeEvent,
  presets: PresetTransferEntry[],
  defaultFilename?: string,
) {
  const { canceled, filePath } = await showSavePresetDialog(event, defaultFilename);

  if (canceled || !filePath) {
    return { canceled: true, exportedCount: 0 };
  }

  await fs.promises.writeFile(
    filePath,
    `${JSON.stringify(createPresetTransferFile(presets), null, 2)}\n`,
    'utf8',
  );

  return { canceled: false, exportedCount: presets.length };
}

function showOpenPresetDialog(event: IpcMainInvokeEvent) {
  const options: OpenDialogOptions = {
    title: 'Import Presets',
    properties: ['openFile'],
    filters: [{ name: 'Fast Renamer Presets', extensions: ['json'] }],
  };
  const window = getDialogWindow(event);

  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

function resolvePreloadPath() {
  const candidates = [
    path.join(mainDir, 'preload.mjs'),
    path.join(mainDir, 'preload.cjs'),
    path.join(mainDir, 'preload.js'),
  ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    throw new Error(`Unable to locate preload script. Checked: ${candidates.join(', ')}`);
  }

  return resolved;
}

function applyContentSecurityPolicy() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const connectSrc = devServerUrl
    ? "'self' ws: wss: http://localhost:* https://github.com"
    : "'self' https://github.com";

  const policy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSrc}`,
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    });
  });
}

function createWindow() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const preloadPath = resolvePreloadPath();
  const isMac = process.platform === 'darwin';

  const window = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1200,
    minHeight: 780,
    roundedCorners: true,
    ...(isMac
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {
          frame: false,
        }),
    backgroundColor: '#0d1117',
    title: 'Fast Renamer',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
    },
  });
  mainWindow = window;

  window.on('maximize', () => emitWindowState(window));
  window.on('unmaximize', () => emitWindowState(window));
  window.on('enter-full-screen', () => emitWindowState(window));
  window.on('leave-full-screen', () => emitWindowState(window));
  window.once('ready-to-show', () => emitWindowState(window));
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'dist-renderer/index.html'));
  }
}

function registerIpc() {
  ipcMain.handle('pickSources', async (_event, payload) => {
    const request = pickSourcesRequestSchema.parse(payload);
    const shouldPickDirectories =
      request.mode === 'picked_folders' ||
      request.mode === 'top_level_folders' ||
      request.mode === 'subfolders' ||
      request.mode === 'top_level_files' ||
      request.mode === 'files_recursive';

    mainWindow?.focus();

    const result = await dialog.showOpenDialog({
      properties: shouldPickDirectories
        ? ['openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections'],
    });
    if (result.canceled) {
      return [];
    }

    const sources = await Promise.all(result.filePaths.map((pathname) => pickableSource(pathname)));
    return sources.sort((left, right) => compareNatural(left.path, right.path));
  });

  ipcMain.handle('resolveSources', async (_event, payload) => {
    const paths = pathListRequestSchema.parse(payload);
    const uniquePaths = [...new Set(paths)].sort(compareNatural);
    const sources = await Promise.all(uniquePaths.map((pathname) => pickableSource(pathname)));
    return sources.sort((left, right) => compareNatural(left.path, right.path));
  });

  ipcMain.handle('loadDirectoryItems', async (_event, payload) => {
    const directoryPaths = [...pathListRequestSchema.parse(payload)].sort(compareNatural);
    const listings = await Promise.all(directoryPaths.map((sourcePath) => loadDirectoryListing(sourcePath)));
    return listings;
  });

  ipcMain.handle('generatePreview', async (_event, payload) => {
    const request = previewRequestSchema.parse(payload);
    return runLatestPreview(toServiceRequest(request));
  });

  ipcMain.handle('executeRenameBatch', async (_event, payload) => {
    const request = executeRenameBatchRequestSchema.parse(payload);
    return executeRenameBatch({ ...toServiceRequest(request), planId: request.planId }, database, {
      planner: previewPlanner,
    });
  });

  ipcMain.handle('undoRenameBatch', async (_event, payload) => {
    const request = undoRenameBatchRequestSchema.parse(payload);
    return undoRenameBatch(request.batchId, getPlatform(), database, database);
  });

  ipcMain.handle('getStartupNotices', () => startupNotices);

  ipcMain.handle('listPresets', () => database.listPresets());

  ipcMain.handle('savePreset', (_event, payload) =>
    database.savePreset(savePresetRequestSchema.parse(payload)),
  );

  ipcMain.handle('renamePreset', (_event, payload) => {
    const request = renamePresetRequestSchema.parse(payload);
    return database.renamePreset(request.id, request.name);
  });

  ipcMain.handle('deletePreset', (_event, payload) => {
    database.deletePreset(deletePresetRequestSchema.parse(payload));
  });

  ipcMain.handle('exportUserPresets', async (event) => {
    const presets = database.listUserPresetTransfers();
    return exportPresetTransferFile(event, presets);
  });

  ipcMain.handle('exportUserPreset', async (event, presetId: number) => {
    const preset = database.getUserPresetTransfer(presetId);
    const defaultFilename = `fast-renamer-${sanitizeExportFilename(preset.name)}.json`;
    return exportPresetTransferFile(event, [preset], defaultFilename);
  });

  ipcMain.handle('importUserPresets', async (event) => {
    const { canceled, filePaths } = await showOpenPresetDialog(event);

    if (canceled || filePaths.length === 0) {
      return { canceled: true, importedCount: 0 };
    }

    const raw = await fs.promises.readFile(filePaths[0], 'utf8');
    const payload = JSON.parse(raw) as unknown;
    const presets = normalizePresetImportPayload(payload);
    const importedCount = database.importUserPresets(presets);

    return { canceled: false, importedCount };
  });

  ipcMain.handle('listHistory', () => listHistoryWithUndoStatus(getPlatform(), database));

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggleMaximize', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) {
      return DEFAULT_WINDOW_STATE;
    }

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }

    return serializeWindowState(window);
  });

  ipcMain.handle('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.handle('window:getState', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? serializeWindowState(window) : DEFAULT_WINDOW_STATE;
  });

  ipcMain.handle('updates:getState', () => updater.getState());
  ipcMain.handle('updates:getChannel', () => updater.getChannel());
  ipcMain.handle('updates:setChannel', (_event, channel: unknown) => {
    if (channel !== 'stable' && channel !== 'ea') {
      throw new Error('Invalid update channel.');
    }

    return updater.setChannel(channel);
  });
  ipcMain.handle('updates:check', () => updater.checkForUpdates());
  ipcMain.handle('updates:quitAndInstall', () => updater.quitAndInstall());
  ipcMain.handle('updates:openDownload', async () => {
    const downloadUrl = updater.getState().downloadUrl;
    if (!downloadUrl) {
      return false;
    }

    await shell.openExternal(downloadUrl);
    return true;
  });
}

function openDatabaseOrQuit() {
  try {
    const opened = openAppDatabase();
    if (opened.notice) {
      startupNotices.push({ level: 'warning', message: opened.notice });
    }
    return opened.database;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[db] Failed to open database', error);
    dialog.showErrorBox(
      error instanceof DatabaseVersionError ? 'Fast Renamer needs an update' : 'Fast Renamer cannot start',
      message,
    );
    app.exit(1);
    return null;
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  applyContentSecurityPolicy();
  const openedDatabase = openDatabaseOrQuit();
  if (!openedDatabase) {
    return;
  }
  database = openedDatabase;
  startupNotices.push(...(await recoverInterruptedRenames(getPlatform(), database)));
  updater = new AppUpdaterManager(() => mainWindow);
  registerIpc();
  createWindow();
  updater.initialize();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  updater?.dispose();
});
