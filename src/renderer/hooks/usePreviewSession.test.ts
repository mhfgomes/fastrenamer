// @vitest-environment jsdom
import { useCallback, useMemo, useRef, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceSelection } from '@fastrenamer/rename-engine/types';
import type {
  AppExecuteRenameBatchResult,
  AppPreviewRequest,
  AppPreviewResult,
  AppUndoRenameBatchResult,
} from '@shared/contracts';
import {
  usePreviewSession,
  type PreviewSessionApi,
  type SessionNotice,
  type UsePreviewSessionOptions,
} from './usePreviewSession';
import { useSourceSelection } from './useSourceSelection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeRequest(template: string, sourcePaths = ['/tmp/a.txt']): AppPreviewRequest {
  return {
    sourcePaths,
    sourceMode: 'picked_files',
    fileNamePattern: '',
    sortMode: 'natural_path',
    rules: [{ id: 'r1', type: 'new_name', enabled: true, template }],
  };
}

function makePreview(planId: string, changed = 1, blocked = false): AppPreviewResult {
  return {
    rows: [],
    summary: { total: 1, changed, ok: changed, conflict: 0, invalid: 0, unchanged: 1 - changed, blocked },
    planId,
    skippedDirectories: 0,
  };
}

function makeExecuteResult(overrides: Partial<AppExecuteRenameBatchResult>): AppExecuteRenameBatchResult {
  return {
    ...makePreview('a'.repeat(64)),
    batchId: 1,
    renamedCount: 1,
    blocked: false,
    errors: [],
    warnings: [],
    planChanged: false,
    historyRecorded: true,
    ...overrides,
  };
}

const PLAN_A = 'a'.repeat(64);
const PLAN_B = 'b'.repeat(64);

function setup(api: PreviewSessionApi, initialRequest: AppPreviewRequest) {
  const callbacks = {
    onRenamed: vi.fn(),
    onMetadataChanged: vi.fn(async () => {}),
    onNotice: vi.fn(),
  };
  const hook = renderHook(
    ({ request }: { request: AppPreviewRequest }) =>
      usePreviewSession({
        request,
        api,
        t: (key) => key,
        debounceMs: 0,
        ...callbacks,
      } satisfies UsePreviewSessionOptions),
    { initialProps: { request: initialRequest } },
  );
  return { ...hook, ...callbacks };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { advancedRenamer?: unknown }).advancedRenamer;
});

/**
 * Mirrors App's wiring of the source selection, the preview session and the notice list:
 * source errors go to the session's actionError, onRenamed resets the sources, warnings become notices.
 */
function setupApp(api: PreviewSessionApi, picked: SourceSelection[]) {
  (window as unknown as { advancedRenamer: unknown }).advancedRenamer = {
    pickSources: vi.fn(async () => picked),
  };
  const rules = [{ id: 'r1', type: 'new_name' as const, enabled: true, template: 'one' }];
  return renderHook(() => {
    const [notices, setNotices] = useState<SessionNotice[]>([]);
    const sessionRef = useRef<ReturnType<typeof usePreviewSession> | null>(null);
    const reportError = useCallback((message: string | null) => sessionRef.current?.setActionError(message), []);
    const isMutatingNow = useCallback(() => sessionRef.current?.isMutatingNow() ?? false, []);
    const pushNotice = useCallback((notice: SessionNotice) => setNotices((current) => [...current, notice]), []);
    const sourceSelection = useSourceSelection({ t: (key) => key, isLocked: isMutatingNow, onError: reportError });
    const { sources, sourceMode, fileNamePattern, sortMode } = sourceSelection;
    const sourcePaths = useMemo(() => sources.map((source) => source.path), [sources]);
    const request = useMemo<AppPreviewRequest>(
      () => ({ sourcePaths, sourceMode, fileNamePattern, sortMode, rules }),
      [fileNamePattern, sortMode, sourceMode, sourcePaths],
    );
    const session = usePreviewSession({
      request,
      api,
      t: (key) => key,
      debounceMs: 0,
      onRenamed: sourceSelection.resetSources,
      onMetadataChanged: async () => {},
      onNotice: pushNotice,
    });
    sessionRef.current = session;
    return { session, sourceSelection, notices };
  });
}

async function pickSources(app: ReturnType<typeof setupApp>) {
  act(() => app.result.current.sourceSelection.openAddSources());
  act(() => app.result.current.sourceSelection.dialog.onConfirm());
  await waitFor(() => expect(app.result.current.sourceSelection.sources).not.toHaveLength(0));
}

const PICKED: SourceSelection[] = [{ path: '/tmp/a.txt', name: 'a.txt', parentPath: '/tmp', isDirectory: false }];

describe('usePreviewSession', () => {
  it('generates a debounced preview and enables execute only for the current request', async () => {
    const api: PreviewSessionApi = {
      generatePreview: vi.fn(async () => makePreview(PLAN_A)),
      executeRenameBatch: vi.fn(),
      undoRenameBatch: vi.fn(),
    };
    const request = makeRequest('one');
    const { result } = setup(api, request);

    await waitFor(() => expect(result.current.canExecute).toBe(true));
    expect(result.current.preview.planId).toBe(PLAN_A);
    expect(result.current.previewLoading).toBe(false);
    expect(api.generatePreview).toHaveBeenCalledWith(request);
  });

  it('disables execute while a newer request is pending and sends the stored request + planId', async () => {
    const second = deferred<AppPreviewResult>();
    const generatePreview = vi
      .fn<PreviewSessionApi['generatePreview']>()
      .mockResolvedValueOnce(makePreview(PLAN_A))
      .mockReturnValueOnce(second.promise);
    const executeRenameBatch = vi.fn(async () => makeExecuteResult({ planId: PLAN_B }));
    const api: PreviewSessionApi = { generatePreview, executeRenameBatch, undoRenameBatch: vi.fn() };

    const first = makeRequest('one');
    const { result, rerender, onRenamed } = setup(api, first);
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    const next = makeRequest('two');
    rerender({ request: next });
    expect(result.current.canExecute).toBe(false);
    expect(result.current.isPreviewCurrent).toBe(false);

    // Execute is refused while the shown preview belongs to an older request.
    await act(async () => {
      await result.current.executeRename();
    });
    expect(executeRenameBatch).not.toHaveBeenCalled();

    await act(async () => {
      second.resolve(makePreview(PLAN_B));
    });
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      await result.current.executeRename();
    });
    expect(executeRenameBatch).toHaveBeenCalledWith({ ...next, planId: PLAN_B });
    expect(onRenamed).toHaveBeenCalledTimes(1);
  });

  it('never runs two mutations at once and is not re-enabled by a preview finishing mid-rename', async () => {
    const execution = deferred<AppExecuteRenameBatchResult>();
    const generatePreview = vi.fn(async () => makePreview(PLAN_A));
    const executeRenameBatch = vi.fn(() => execution.promise);
    const undoRenameBatch = vi.fn();
    const api: PreviewSessionApi = { generatePreview, executeRenameBatch, undoRenameBatch };

    const { result } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    let firstRun!: Promise<void>;
    act(() => {
      firstRun = result.current.executeRename();
    });
    expect(result.current.mutation).toBe('execute');

    // A manual refresh completing during the rename must not re-enable Rename.
    await act(async () => {
      result.current.refreshPreview();
    });
    await waitFor(() => expect(result.current.previewLoading).toBe(false));
    expect(result.current.canExecute).toBe(false);

    await act(async () => {
      await result.current.executeRename();
      await result.current.undoBatch(3);
    });
    expect(executeRenameBatch).toHaveBeenCalledTimes(1);
    expect(undoRenameBatch).not.toHaveBeenCalled();

    await act(async () => {
      execution.resolve(makeExecuteResult({}));
      await firstRun;
    });
    expect(result.current.mutation).toBe('idle');
  });

  it('shows the refreshed plan and a notice when the plan changed before execution', async () => {
    const changedRows = makePreview(PLAN_B, 1);
    const api: PreviewSessionApi = {
      generatePreview: vi.fn(async () => makePreview(PLAN_A)),
      executeRenameBatch: vi.fn(async () =>
        makeExecuteResult({ ...changedRows, renamedCount: 0, batchId: null, planChanged: true }),
      ),
      undoRenameBatch: vi.fn(),
    };
    const { result, onRenamed, onNotice } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      await result.current.executeRename();
    });

    expect(onRenamed).not.toHaveBeenCalled();
    expect(onNotice).toHaveBeenCalledWith({ level: 'warning', message: 'preview.plan_changed' });
    expect(result.current.preview.planId).toBe(PLAN_B);
    expect(result.current.canExecute).toBe(true);
  });

  it('marks the preview stale on failure and ignores superseded previews', async () => {
    const generatePreview = vi
      .fn<PreviewSessionApi['generatePreview']>()
      .mockResolvedValueOnce(makePreview(PLAN_A))
      .mockRejectedValueOnce(new Error("Error invoking remote method 'generatePreview': WorkerTaskTimeoutError: Preview timed out."))
      .mockRejectedValueOnce(new Error("Error invoking remote method 'generatePreview': PreviewSupersededError: Preview was superseded by a newer request."));
    const api: PreviewSessionApi = { generatePreview, executeRenameBatch: vi.fn(), undoRenameBatch: vi.fn() };
    const { result } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      result.current.refreshPreview();
    });
    await waitFor(() => expect(result.current.previewError).toBe('Preview timed out.'));
    expect(result.current.canExecute).toBe(false);

    await act(async () => {
      result.current.refreshPreview();
    });
    await waitFor(() => expect(result.current.previewLoading).toBe(false));
    expect(result.current.previewError).toBe('Preview timed out.');
  });

  it('keeps the undo error when the follow-up preview refresh succeeds', async () => {
    const undoResult: AppUndoRenameBatchResult = {
      batchId: 4,
      restoredCount: 0,
      success: false,
      errors: ['Could not restore a.txt.'],
      warnings: [],
    };
    const generatePreview = vi.fn(async () => makePreview(PLAN_A));
    const api: PreviewSessionApi = {
      generatePreview,
      executeRenameBatch: vi.fn(),
      undoRenameBatch: vi.fn(async () => undoResult),
    };
    const { result } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      await result.current.undoBatch(4);
    });
    await waitFor(() => expect(generatePreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.previewLoading).toBe(false));
    expect(result.current.actionError).toBe('Could not restore a.txt.');
    expect(result.current.canExecute).toBe(true);
  });

  it('reports busy errors from the main process as action errors', async () => {
    const api: PreviewSessionApi = {
      generatePreview: vi.fn(async () => makePreview(PLAN_A)),
      executeRenameBatch: vi.fn(async () => {
        throw new Error("Error invoking remote method 'executeRenameBatch': OperationBusyError: Another undo is still running.");
      }),
      undoRenameBatch: vi.fn(),
    };
    const { result } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));
    await act(async () => {
      await result.current.executeRename();
    });
    expect(result.current.actionError).toBe('Another undo is still running.');
    expect(result.current.mutation).toBe('idle');
  });

  it('stops loading when the sources are cleared mid-preview', async () => {
    const pending = deferred<AppPreviewResult>();
    const api: PreviewSessionApi = {
      generatePreview: vi.fn(() => pending.promise),
      executeRenameBatch: vi.fn(),
      undoRenameBatch: vi.fn(),
    };
    const { result, rerender } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.previewLoading).toBe(true));

    rerender({ request: makeRequest('one', []) });
    expect(result.current.previewLoading).toBe(false);

    await act(async () => {
      pending.resolve(makePreview(PLAN_A));
    });
    expect(result.current.preview.planId).toBe('');
    expect(result.current.canExecute).toBe(false);
  });
  it('marks the preview stale and regenerates after a resolved execution failure with nothing renamed', async () => {
    const regenerated = deferred<AppPreviewResult>();
    const generatePreview = vi
      .fn<PreviewSessionApi['generatePreview']>()
      .mockResolvedValueOnce(makePreview(PLAN_A))
      .mockReturnValueOnce(regenerated.promise);
    // Shape returned by the service when the filesystem moves fail: rows/summary are the pre-execution
    // preview (summary.blocked false), blocked true, nothing renamed.
    const executeRenameBatch = vi.fn(async () =>
      makeExecuteResult({
        batchId: null,
        renamedCount: 0,
        blocked: true,
        historyRecorded: false,
        errors: ['Rename execution failed: EPERM. All completed renames were reverted.'],
      }),
    );
    const api: PreviewSessionApi = { generatePreview, executeRenameBatch, undoRenameBatch: vi.fn() };
    const { result, onRenamed } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      await result.current.executeRename();
    });

    expect(onRenamed).not.toHaveBeenCalled();
    expect(generatePreview).toHaveBeenCalledTimes(2);
    expect(result.current.isPreviewCurrent).toBe(false);
    expect(result.current.canExecute).toBe(false);
    expect(result.current.actionError).toContain('Rename execution failed');

    // Still not runnable from the pre-execution rows; only a fresh preview re-enables Rename.
    await act(async () => {
      await result.current.executeRename();
    });
    expect(executeRenameBatch).toHaveBeenCalledTimes(1);

    await act(async () => {
      regenerated.resolve(makePreview(PLAN_B));
    });
    await waitFor(() => expect(result.current.canExecute).toBe(true));
    expect(result.current.preview.planId).toBe(PLAN_B);
    expect(result.current.actionError).toContain('Rename execution failed');
  });

  it('keeps Rename disabled and surfaces the error when the rollback failed and the regenerate fails', async () => {
    const rollbackError =
      'Rename execution failed: EPERM Some renames could not be reverted: /tmp/.frtmp-1 -> /tmp/a.txt: EPERM';
    const generatePreview = vi
      .fn<PreviewSessionApi['generatePreview']>()
      .mockResolvedValueOnce(makePreview(PLAN_A))
      .mockRejectedValueOnce(new Error("ENOENT: no such file or directory, stat '/tmp/a.txt'"));
    const api: PreviewSessionApi = {
      generatePreview,
      executeRenameBatch: vi.fn(async () =>
        makeExecuteResult({
          batchId: null,
          renamedCount: 0,
          blocked: true,
          historyRecorded: false,
          errors: [rollbackError],
          warnings: ['A file was left under a temporary name.'],
        }),
      ),
      undoRenameBatch: vi.fn(),
    };
    const { result, onNotice } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      await result.current.executeRename();
    });
    await waitFor(() => expect(result.current.previewError).toContain('ENOENT'));

    expect(generatePreview).toHaveBeenCalledTimes(2);
    expect(result.current.actionError).toBe(rollbackError);
    expect(onNotice).toHaveBeenCalledWith({ level: 'warning', message: 'A file was left under a temporary name.' });
    expect(result.current.isPreviewCurrent).toBe(false);
    expect(result.current.canExecute).toBe(false);
  });

  it('does not regenerate or mark stale after a fully successful rename', async () => {
    const generatePreview = vi.fn(async () => makePreview(PLAN_A));
    const api: PreviewSessionApi = {
      generatePreview,
      executeRenameBatch: vi.fn(async () => makeExecuteResult({})),
      undoRenameBatch: vi.fn(),
    };
    const { result, onRenamed } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      await result.current.executeRename();
    });

    expect(onRenamed).toHaveBeenCalledTimes(1);
    expect(generatePreview).toHaveBeenCalledTimes(1);
    expect(result.current.actionError).toBeNull();
  });

  it('shows a changed plan as current without regenerating it', async () => {
    const generatePreview = vi.fn(async () => makePreview(PLAN_A));
    const api: PreviewSessionApi = {
      generatePreview,
      executeRenameBatch: vi.fn(async () =>
        makeExecuteResult({ ...makePreview(PLAN_B), renamedCount: 0, batchId: null, blocked: true, planChanged: true }),
      ),
      undoRenameBatch: vi.fn(),
    };
    const { result } = setup(api, makeRequest('one'));
    await waitFor(() => expect(result.current.canExecute).toBe(true));

    await act(async () => {
      await result.current.executeRename();
    });

    expect(generatePreview).toHaveBeenCalledTimes(1);
    expect(result.current.isPreviewCurrent).toBe(true);
    expect(result.current.preview.planId).toBe(PLAN_B);
    expect(result.current.canExecute).toBe(true);
  });
});

describe('usePreviewSession wired like App (sources + notices)', () => {
  it('keeps a history-failure warning after a successful rename resets the sources', async () => {
    const warning = '1 item(s) were renamed, but the rename could not be saved to history (disk full). It cannot be undone from the app.';
    const generatePreview = vi.fn(async () => makePreview(PLAN_A));
    const api: PreviewSessionApi = {
      generatePreview,
      executeRenameBatch: vi.fn(async () =>
        makeExecuteResult({ batchId: null, historyRecorded: false, warnings: [warning] }),
      ),
      undoRenameBatch: vi.fn(),
    };
    const app = setupApp(api, PICKED);
    await pickSources(app);
    await waitFor(() => expect(app.result.current.session.canExecute).toBe(true));

    await act(async () => {
      await app.result.current.session.executeRename();
    });

    expect(app.result.current.sourceSelection.sources).toHaveLength(0);
    expect(app.result.current.session.preview.planId).toBe('');
    expect(app.result.current.notices).toEqual([{ level: 'warning', message: warning }]);
    expect(app.result.current.session.actionError).toBeNull();
  });

  it('keeps an undo error through the follow-up refresh and a manual refresh', async () => {
    const generatePreview = vi.fn(async () => makePreview(PLAN_A));
    const api: PreviewSessionApi = {
      generatePreview,
      executeRenameBatch: vi.fn(),
      undoRenameBatch: vi.fn(async () => ({
        batchId: 7,
        restoredCount: 0,
        success: false,
        errors: ['Could not restore a.txt.'],
        warnings: [],
      })),
    };
    const app = setupApp(api, PICKED);
    await pickSources(app);
    await waitFor(() => expect(app.result.current.session.canExecute).toBe(true));

    await act(async () => {
      await app.result.current.session.undoBatch(7);
    });
    await waitFor(() => expect(generatePreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(app.result.current.session.previewLoading).toBe(false));
    expect(app.result.current.session.actionError).toBe('Could not restore a.txt.');

    await act(async () => {
      app.result.current.session.refreshPreview();
    });
    await waitFor(() => expect(generatePreview).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(app.result.current.session.previewLoading).toBe(false));
    expect(app.result.current.session.actionError).toBe('Could not restore a.txt.');
    expect(app.result.current.sourceSelection.sources).toHaveLength(1);
  });
});
