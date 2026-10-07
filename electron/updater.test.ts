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
  };

  return { autoUpdater };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '0.2.0-ea.5',
    getPath: () => '/tmp/fastrenamer-updater-test',
  },
  BrowserWindow: class {},
}));

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('AppUpdaterManager.setChannel', () => {
  beforeEach(() => {
    mocks.autoUpdater.checkForUpdates.mockReset();
    mocks.autoUpdater.channel = 'latest';
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
});
