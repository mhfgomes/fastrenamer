import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import type { UpdateChannel, UpdateManualReason, UpdateState } from '../src/shared/contracts';
import {
  applyUpdateChannelSettings,
  getReleaseDownloadUrl,
  resolveDefaultUpdateChannel,
} from './update-channel';
import { resolveManualUpdateReason } from './update-reason';

const { autoUpdater } = electronUpdater;

const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 6;
const UPDATE_CHANNEL_FILE = 'update-channel.json';

function toIsoDate(value?: string | Date) {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getManualUpdateReason() {
  return resolveManualUpdateReason({
    platform: process.platform,
    isPackaged: app.isPackaged,
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    inspectCodeSignature: () => {
      const appBundlePath = path.resolve(process.execPath, '..', '..', '..');
      const result = spawnSync('codesign', ['-dv', '--verbose=4', appBundlePath], { encoding: 'utf8' });
      return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
    },
  });
}

function getChannelFilePath() {
  return path.join(app.getPath('userData'), UPDATE_CHANNEL_FILE);
}

function loadStoredUpdateChannel(): UpdateChannel | undefined {
  try {
    const raw = fs.readFileSync(getChannelFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { channel?: unknown };
    if (parsed.channel === 'ea' || parsed.channel === 'stable') {
      return parsed.channel;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function saveUpdateChannel(channel: UpdateChannel) {
  fs.writeFileSync(getChannelFilePath(), JSON.stringify({ channel }), 'utf8');
}

function toBaseState(
  info: UpdateInfo | UpdateDownloadedEvent | undefined,
  previousState: UpdateState | undefined,
  channel: UpdateChannel,
) {
  return {
    currentVersion: app.getVersion(),
    availableVersion: info?.version ?? previousState?.availableVersion,
    releaseDate: toIsoDate(info?.releaseDate) ?? previousState?.releaseDate,
    releaseName: info?.releaseName ?? previousState?.releaseName,
    manualDownloadOnly: previousState?.manualDownloadOnly ?? false,
    downloadUrl: previousState?.downloadUrl,
    channel,
  };
}

export class AppUpdaterManager {
  private state: UpdateState = {
    status: 'idle',
    currentVersion: app.getVersion(),
    channel: resolveDefaultUpdateChannel(app.getVersion()),
  };

  private channel: UpdateChannel = this.state.channel;
  private interval: NodeJS.Timeout | null = null;
  private initialized = false;
  private checking = false;
  private manualDownloadOnly = false;
  private manualReason?: UpdateManualReason;

  constructor(private readonly getWindow: () => BrowserWindow | null) {}

  getState() {
    return this.state;
  }

  getChannel() {
    return this.channel;
  }

  initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.channel = loadStoredUpdateChannel() ?? resolveDefaultUpdateChannel(app.getVersion());

    if (!app.isPackaged) {
      this.setState({
        status: 'disabled',
        currentVersion: app.getVersion(),
        channel: this.channel,
        reason: 'not-packaged',
      });
      return;
    }

    this.manualReason = getManualUpdateReason();
    this.manualDownloadOnly = Boolean(this.manualReason);
    applyUpdateChannelSettings(autoUpdater, this.channel);

    if (this.manualDownloadOnly) {
      this.setState({
        ...this.state,
        channel: this.channel,
        manualDownloadOnly: true,
        reason: this.manualReason,
        downloadUrl: getReleaseDownloadUrl(this.channel),
      });
    } else {
      this.setState({
        ...this.state,
        channel: this.channel,
      });
    }

    autoUpdater.autoDownload = !this.manualDownloadOnly;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      this.setState({
        ...toBaseState(undefined, this.state, this.channel),
        status: 'checking',
        checkedAt: new Date().toISOString(),
        reason: this.manualReason,
      });
    });

    autoUpdater.on('update-available', (info) => {
      const downloadUrl = getReleaseDownloadUrl(this.channel, info.version);
      this.setState({
        ...toBaseState(info, this.state, this.channel),
        status: 'available',
        checkedAt: new Date().toISOString(),
        reason: this.manualReason,
        manualDownloadOnly: this.manualDownloadOnly,
        downloadUrl,
      });
    });

    autoUpdater.on('update-not-available', (info) => {
      this.setState({
        ...toBaseState(info, this.state, this.channel),
        status: 'up-to-date',
        checkedAt: new Date().toISOString(),
        reason: this.manualReason,
        manualDownloadOnly: this.manualDownloadOnly,
        downloadUrl: this.manualDownloadOnly ? getReleaseDownloadUrl(this.channel) : undefined,
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      this.setState({
        ...toBaseState(undefined, this.state, this.channel),
        status: 'downloading',
        checkedAt: this.state.checkedAt ?? new Date().toISOString(),
        progress: this.toProgress(progress),
        message: undefined,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        ...toBaseState(info, this.state, this.channel),
        status: 'downloaded',
        checkedAt: new Date().toISOString(),
        message: undefined,
      });
    });

    autoUpdater.on('error', (error) => {
      this.setState({
        ...toBaseState(undefined, this.state, this.channel),
        status: 'error',
        checkedAt: new Date().toISOString(),
        manualDownloadOnly: this.manualDownloadOnly,
        downloadUrl: this.manualDownloadOnly
          ? getReleaseDownloadUrl(this.channel)
          : this.state.downloadUrl,
        message: error.message || 'Failed to check for updates.',
      });
    });

    void this.checkForUpdates();
    this.interval = setInterval(() => {
      void this.checkForUpdates();
    }, UPDATE_CHECK_INTERVAL_MS);
  }

  dispose() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async setChannel(channel: UpdateChannel) {
    this.channel = channel;
    saveUpdateChannel(channel);

    if (!app.isPackaged) {
      this.setState({
        ...this.state,
        channel,
      });
      return this.state;
    }

    applyUpdateChannelSettings(autoUpdater, channel);

    if (this.manualDownloadOnly) {
      this.setState({
        ...this.state,
        channel,
        downloadUrl: getReleaseDownloadUrl(channel),
      });
    } else {
      this.setState({
        ...this.state,
        channel,
      });
    }

    return this.checkForUpdates();
  }

  async checkForUpdates() {
    if (!app.isPackaged) {
      return this.state;
    }

    if (this.checking) {
      return this.state;
    }

    this.checking = true;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for updates.';
      this.setState({
        ...toBaseState(undefined, this.state, this.channel),
        status: 'error',
        checkedAt: new Date().toISOString(),
        manualDownloadOnly: this.manualDownloadOnly,
        downloadUrl: this.manualDownloadOnly
          ? getReleaseDownloadUrl(this.channel)
          : this.state.downloadUrl,
        message,
      });
    } finally {
      this.checking = false;
    }

    return this.state;
  }

  quitAndInstall() {
    if (this.state.status !== 'downloaded') {
      return false;
    }

    this.setState({
      ...this.state,
      status: 'installing',
    });
    autoUpdater.quitAndInstall(false, true);
    return true;
  }

  private toProgress(progress: ProgressInfo) {
    return {
      bytesPerSecond: progress.bytesPerSecond,
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    };
  }

  private setState(nextState: UpdateState) {
    this.state = nextState;
    const window = this.getWindow();
    window?.webContents.send('update:stateChanged', nextState);
  }
}
