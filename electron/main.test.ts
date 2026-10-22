import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lock: vi.fn(), quit: vi.fn(), ready: vi.fn(), on: vi.fn(),
  open: vi.fn(), recover: vi.fn(), menu: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { requestSingleInstanceLock: mocks.lock, quit: mocks.quit, whenReady: mocks.ready, on: mocks.on,
    getAppPath: () => '/app' },
  BrowserWindow: vi.fn(), dialog: {}, ipcMain: {}, Menu: { setApplicationMenu: mocks.menu },
  session: {}, shell: {},
}));
vi.mock('./db', () => ({ openAppDatabase: mocks.open, DatabaseVersionError: class extends Error {} }));
vi.mock('./rename-journal', () => ({ recoverInterruptedRenames: mocks.recover }));
vi.mock('./updater', () => ({ AppUpdaterManager: vi.fn() }));
vi.mock('./preview-worker-client', () => ({ createWorkerPlanner: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it('quits a secondary process without scheduling startup, opening the database or recovering journals', async () => {
  mocks.lock.mockReturnValue(false);
  await import('./main');
  expect(mocks.quit).toHaveBeenCalledOnce();
  expect(mocks.ready).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.recover).not.toHaveBeenCalled();
  expect(mocks.on).not.toHaveBeenCalled();
});

it('acquires ownership before readiness, database access and recovery', async () => {
  mocks.lock.mockReturnValue(true);
  let startup: () => Promise<void>;
  mocks.ready.mockReturnValue({ then: (callback: () => Promise<void>) => { startup = callback; } });
  // Stop before window creation, after proving that the real startup invokes recovery.
  mocks.open.mockReturnValue({ database: {} });
  const stop = new Error('stop after recovery');
  mocks.recover.mockRejectedValue(stop);
  await import('./main');
  expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.ready.mock.invocationCallOrder[0]);
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
  await expect(startup!()).rejects.toThrow(stop);
  expect(mocks.open.mock.invocationCallOrder[0]).toBeLessThan(mocks.recover.mock.invocationCallOrder[0]);
  expect(mocks.recover).toHaveBeenCalledWith(process.platform, {});
  // A launch arriving while recovery is pending must not open a window early.
  const secondInstance = mocks.on.mock.calls.find(([event]) => event === 'second-instance')![1];
  expect(() => secondInstance()).not.toThrow();
});
