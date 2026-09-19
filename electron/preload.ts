import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AdvancedRenamerApi } from '../src/shared/contracts';

const api: AdvancedRenamerApi = {
  getDroppedPaths: (files) =>
    files
      .map((file) => webUtils.getPathForFile(file))
      .filter((pathname) => pathname.length > 0),
  pickSources: (request) => ipcRenderer.invoke('pickSources', request),
  resolveSources: (paths) => ipcRenderer.invoke('resolveSources', paths),
  loadDirectoryItems: (paths) => ipcRenderer.invoke('loadDirectoryItems', paths),
  generatePreview: (request) => ipcRenderer.invoke('generatePreview', request),
  executeRenameBatch: (request) => ipcRenderer.invoke('executeRenameBatch', request),
  undoRenameBatch: (request) => ipcRenderer.invoke('undoRenameBatch', request),
  listPresets: () => ipcRenderer.invoke('listPresets'),
  savePreset: (input) => ipcRenderer.invoke('savePreset', input),
  deletePreset: (id) => ipcRenderer.invoke('deletePreset', id),
  exportUserPresets: () => ipcRenderer.invoke('exportUserPresets'),
  exportUserPreset: (id) => ipcRenderer.invoke('exportUserPreset', id),
  importUserPresets: () => ipcRenderer.invoke('importUserPresets'),
  listHistory: () => ipcRenderer.invoke('listHistory'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggleMaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  getWindowState: () => ipcRenderer.invoke('window:getState'),
  onWindowStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => {
      listener(state);
    };
    ipcRenderer.on('window:stateChanged', handler);
    return () => {
      ipcRenderer.off('window:stateChanged', handler);
    };
  },
  getUpdateState: () => ipcRenderer.invoke('updates:getState'),
  getUpdateChannel: () => ipcRenderer.invoke('updates:getChannel'),
  setUpdateChannel: (channel) => ipcRenderer.invoke('updates:setChannel', channel),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  quitAndInstallUpdate: () => ipcRenderer.invoke('updates:quitAndInstall'),
  openUpdateDownload: () => ipcRenderer.invoke('updates:openDownload'),
  onUpdateStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => {
      listener(state);
    };
    ipcRenderer.on('update:stateChanged', handler);
    return () => {
      ipcRenderer.off('update:stateChanged', handler);
    };
  },
};

contextBridge.exposeInMainWorld('advancedRenamer', api);
