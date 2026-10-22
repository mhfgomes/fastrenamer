import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const autoUpdater = {
    channel: 'latest' as string | null,
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    autoInstallOnAppQuit: false,
    on: vi.fn(),
    checkForUpdates: vi.fn<() => Promise<unknown>>(),
    quitAndInstall: vi.fn(),
    downloadUpdate: vi.fn<() => Promise<string[]>>(),
  };

  return { autoUpdater, appOn: vi.fn() };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.2.0-ea.5',
    on: mocks.appOn,
    getPath: () => '/tmp/fastrenamer-updater-test',
  },
  BrowserWindow: class {},
}));

vi.mock('./update-reason', () => ({ resolveManualUpdateReason: () => undefined }));

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mocks.autoUpdater },
}));

vi.mock('node:fs', () => {
  const fs = {
    readFileSync: vi.fn(() => {
      throw new Error('ENOENT');
    }),
    writeFileSync: vi.fn(),
  };
  return { default: fs, ...fs };
});

const { AppUpdaterManager } = await import('./updater');

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const listeners = new Map<string, (...args: any[]) => void>();
const emit = (name: string, ...args: unknown[]) => listeners.get(name)?.(...args);
const update = (version: string) => ({ version, files: [], releaseDate: '2026-10-22' });

describe('AppUpdaterManager.setChannel', () => {
  beforeEach(() => {
    mocks.autoUpdater.checkForUpdates.mockReset();
    mocks.autoUpdater.channel = 'latest';
    mocks.autoUpdater.downloadUpdate.mockReset();
    mocks.autoUpdater.quitAndInstall.mockReset();
    mocks.appOn.mockClear();
    listeners.clear();
    mocks.autoUpdater.on.mockImplementation((name, callback) => {
      listeners.set(name, callback);
    });
  });

  it('re-checks the new channel after an in-flight check finishes', async () => {
    const manager = new AppUpdaterManager(() => null);
    const checkedChannels: Array<string | null> = [];
    const firstCheck = deferred();

    mocks.autoUpdater.checkForUpdates
      .mockImplementationOnce(async () => {
        checkedChannels.push(mocks.autoUpdater.channel);
        await firstCheck.promise;
      })
      .mockImplementation(async () => {
        checkedChannels.push(mocks.autoUpdater.channel);
      });

    // Start a check on the EA channel and switch to Stable while it runs.
    manager.initialize();
    const switched = manager.setChannel('stable');

    expect(checkedChannels).toEqual(['ea']);

    firstCheck.resolve();
    await switched;

    expect(checkedChannels).toEqual(['ea', 'latest']);
    expect(mocks.autoUpdater.allowDowngrade).toBe(false);
    manager.dispose();
  });

  it('does not run extra checks when no check is in flight', async () => {
    const manager = new AppUpdaterManager(() => null);
    mocks.autoUpdater.checkForUpdates.mockResolvedValue(undefined);

    manager.initialize();
    await manager.checkForUpdates();
    mocks.autoUpdater.checkForUpdates.mockClear();

    await manager.setChannel('stable');
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('coalesces concurrent checks into the in-flight one', async () => {
    const manager = new AppUpdaterManager(() => null);
    const firstCheck = deferred();
    mocks.autoUpdater.checkForUpdates.mockImplementation(() => firstCheck.promise);

    manager.initialize();
    const second = manager.checkForUpdates();
    firstCheck.resolve();
    await second;

    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it('cancels and drains an EA download before checking Stable, ignoring late completion', async () => {
    const download = deferred<string[]>();
    const cancel = vi.fn();
    mocks.autoUpdater.checkForUpdates
      .mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: update('0.3.0-ea.1'), cancellationToken: { cancel } })
      .mockImplementation(async () => {
        emit('update-not-available', update('0.2.0'));
        return { isUpdateAvailable: false };
      });
    mocks.autoUpdater.downloadUpdate.mockReturnValue(download.promise);
    const manager = new AppUpdaterManager(() => null);
    manager.initialize();
    await manager.checkForUpdates();
    expect(mocks.autoUpdater.autoDownload).toBe(false);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);

    const switched = manager.setChannel('stable');
    expect(cancel).toHaveBeenCalledTimes(1);
    emit('update-downloaded', update('0.3.0-ea.1'));
    emit('error', new Error('cancelled old channel'));
    expect(manager.getState().status).toBe('idle');
    expect(manager.quitAndInstall()).toBe(false);
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);

    download.resolve([]);
    await switched;
    expect(manager.getState()).toMatchObject({ channel: 'stable', status: 'up-to-date' });
    expect(manager.quitAndInstall()).toBe(false);
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('retires an already downloaded installer on channel change', async () => {
    const download = deferred<string[]>();
    mocks.autoUpdater.checkForUpdates
      .mockResolvedValueOnce({ isUpdateAvailable: true, updateInfo: update('0.3.0-ea.1') })
      .mockImplementation(async () => {
        emit('update-not-available', update('0.2.0'));
        return { isUpdateAvailable: false };
      });
    mocks.autoUpdater.downloadUpdate.mockReturnValue(download.promise);
    const manager = new AppUpdaterManager(() => null);
    manager.initialize();
    await manager.checkForUpdates();
    emit('update-downloaded', update('0.3.0-ea.1'));
    expect(manager.getState().status).toBe('downloaded');
    download.resolve([]);
    await manager.setChannel('stable');
    expect(manager.quitAndInstall()).toBe(false);
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false);
    const beforeQuit = mocks.appOn.mock.calls.find(([name]) => name === 'before-quit')![1];
    const preventDefault = vi.fn();
    beforeQuit({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    manager.dispose();
  });

  it('allows installation only for the current download and prevents duplicate install', async () => {
    const download = deferred<string[]>();
    mocks.autoUpdater.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true, updateInfo: update('0.3.0-ea.1') });
    mocks.autoUpdater.downloadUpdate.mockReturnValue(download.promise);
    const manager = new AppUpdaterManager(() => null);
    manager.initialize();
    await manager.checkForUpdates();
    emit('update-downloaded', update('0.9.0-ea.9'));
    expect(manager.quitAndInstall()).toBe(false);
    emit('update-downloaded', update('0.3.0-ea.1'));
    const beforeQuit = mocks.appOn.mock.calls.find(([name]) => name === 'before-quit')![1];
    const preventDefault = vi.fn();
    beforeQuit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(manager.quitAndInstall()).toBe(false);
    beforeQuit({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1);
    download.resolve([]);
    manager.dispose();
  });

  it('does not start downloading from a check superseded by a channel change', async () => {
    const check = deferred<unknown>();
    mocks.autoUpdater.checkForUpdates.mockReturnValueOnce(check.promise).mockResolvedValue({ isUpdateAvailable: false });
    const manager = new AppUpdaterManager(() => null);
    manager.initialize();
    const switched = manager.setChannel('stable');
    emit('update-available', update('0.3.0-ea.1'));
    check.resolve({ isUpdateAvailable: true, updateInfo: update('0.3.0-ea.1') });
    await switched;
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(manager.getState().availableVersion).toBeUndefined();
    manager.dispose();
  });

});
