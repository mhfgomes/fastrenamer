import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import type {
  AdvancedRenamerApi,
  AppExecuteRenameBatchResult,
  AppPreviewRequest,
  AppPreviewResult,
} from '@shared/contracts';
import { DEFAULT_PREVIEW } from '../app/defaults';
import { getErrorMessage, isPreviewSupersededError } from '../app/ipc-errors';

export type PreviewSessionApi = Pick<
  AdvancedRenamerApi,
  'generatePreview' | 'executeRenameBatch' | 'undoRenameBatch'
>;

export type MutationState = 'idle' | 'execute' | 'undo';

export interface SessionNotice {
  level: 'info' | 'warning';
  message: string;
}

export interface UsePreviewSessionOptions {
  /** Current request. Must be referentially stable while its inputs do not change (useMemo). */
  request: AppPreviewRequest;
  api: PreviewSessionApi;
  t: (key: string, vars?: Record<string, unknown>) => string;
  /** Called after a fully successful rename (the app clears its sources). */
  onRenamed: () => void;
  /** Called after execute/undo so presets/history can be reloaded. */
  onMetadataChanged: () => Promise<void> | void;
  onNotice: (notice: SessionNotice) => void;
  debounceMs?: number;
}

/** A preview result together with the exact request that produced it. */
interface ShownPreview {
  result: AppPreviewResult;
  request: AppPreviewRequest;
  /** The last attempt to regenerate this request failed, or files changed since. */
  stale: boolean;
}

function toPreviewResult(result: AppExecuteRenameBatchResult): AppPreviewResult {
  return {
    rows: result.rows,
    summary: result.summary,
    planId: result.planId,
    skippedDirectories: result.skippedDirectories,
  };
}

/**
 * Owns the preview/rename lifecycle:
 * - previews are debounced and versioned; late responses for older requests are dropped;
 * - each shown preview remembers the request that produced it, and Rename only runs that request
 *   with that preview's planId — and only while it still equals the current request;
 * - preview loading and mutations (execute/undo) are separate states, and mutations are guarded by
 *   a ref so a double click can never start two of them;
 * - preview errors and action errors are kept apart so a preview refresh cannot erase an undo error.
 */
export function usePreviewSession({
  request,
  api,
  t,
  onRenamed,
  onMetadataChanged,
  onNotice,
  debounceMs = 180,
}: UsePreviewSessionOptions) {
  const [shown, setShown] = useState<ShownPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<MutationState>('idle');
  const [actionError, setActionError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const mutatingRef = useRef(false);
  const requestRef = useRef(request);
  const shownRef = useRef(shown);
  const loadingRef = useRef(previewLoading);
  const optionsRef = useRef({ api, t, onRenamed, onMetadataChanged, onNotice });

  requestRef.current = request;
  shownRef.current = shown;
  loadingRef.current = previewLoading;
  optionsRef.current = { api, t, onRenamed, onMetadataChanged, onNotice };

  const runPreview = useCallback(async (target: AppPreviewRequest) => {
    if (target.sourcePaths.length === 0) return;
    const { api: currentApi, t: translate } = optionsRef.current;
    const generation = ++generationRef.current;
    loadingRef.current = true;
    setPreviewLoading(true);
    try {
      const result = await currentApi.generatePreview(target);
      if (generation !== generationRef.current) return;
      setPreviewError(null);
      startTransition(() => setShown({ result, request: target, stale: false }));
    } catch (error) {
      if (generation !== generationRef.current || isPreviewSupersededError(error)) return;
      setShown((current) => (current ? { ...current, stale: true } : current));
      setPreviewError(getErrorMessage(error, translate('error.generate_preview')));
    } finally {
      if (generation === generationRef.current) {
        loadingRef.current = false;
        setPreviewLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (request.sourcePaths.length === 0) {
      generationRef.current += 1;
      loadingRef.current = false;
      setShown(null);
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    const timer = window.setTimeout(() => void runPreview(request), debounceMs);
    return () => {
      window.clearTimeout(timer);
      // Responses for this request are no longer wanted once it changed.
      generationRef.current += 1;
    };
  }, [debounceMs, request, runPreview]);

  const refreshPreview = useCallback(() => {
    if (mutatingRef.current) return;
    void runPreview(requestRef.current);
  }, [runPreview]);

  const isRunnable = (candidate: ShownPreview | null, current: AppPreviewRequest, loading: boolean) =>
    candidate !== null &&
    !candidate.stale &&
    candidate.request === current &&
    !loading &&
    !candidate.result.summary.blocked &&
    candidate.result.summary.changed > 0 &&
    candidate.result.planId.length > 0;

  const executeRename = useCallback(async () => {
    const approved = shownRef.current;
    if (mutatingRef.current || !approved || !isRunnable(approved, requestRef.current, loadingRef.current)) {
      return;
    }
    const { api: currentApi, t: translate } = optionsRef.current;
    mutatingRef.current = true;
    setMutation('execute');
    setActionError(null);
    // Drop any preview still in flight: it describes the filesystem before this rename.
    generationRef.current += 1;
    loadingRef.current = false;
    setPreviewLoading(false);

    let refreshAfter = false;
    try {
      const result = await currentApi.executeRenameBatch({
        ...approved.request,
        planId: approved.result.planId,
      });

      if (result.planChanged) {
        setShown({ result: toPreviewResult(result), request: approved.request, stale: false });
        optionsRef.current.onNotice({ level: 'warning', message: translate('preview.plan_changed') });
        return;
      }

      if (result.warnings.length > 0) {
        optionsRef.current.onNotice({ level: 'warning', message: result.warnings.join(' ') });
      }
      if (result.errors.length > 0) {
        setActionError(result.errors.join(' '));
      }

      if (result.renamedCount > 0 && result.errors.length === 0) {
        optionsRef.current.onRenamed();
      } else {
        // Partially renamed: the result rows describe the old filesystem; regenerate.
        refreshAfter = result.renamedCount > 0;
        setShown({ result: toPreviewResult(result), request: approved.request, stale: refreshAfter });
      }
      await optionsRef.current.onMetadataChanged();
    } catch (error) {
      setActionError(getErrorMessage(error));
      // The filesystem may no longer match the preview (e.g. a source disappeared): regenerate.
      refreshAfter = true;
      setShown((current) => (current ? { ...current, stale: true } : current));
    } finally {
      mutatingRef.current = false;
      setMutation('idle');
    }

    if (refreshAfter) {
      void runPreview(requestRef.current);
    }
  }, [runPreview]);

  const undoBatch = useCallback(
    async (batchId: number) => {
      if (mutatingRef.current) return;
      mutatingRef.current = true;
      setMutation('undo');
      setActionError(null);
      generationRef.current += 1;
      loadingRef.current = false;
      setPreviewLoading(false);
      setShown((current) => (current ? { ...current, stale: true } : current));

      try {
        const result = await optionsRef.current.api.undoRenameBatch({ batchId });
        if (result.errors.length > 0) {
          setActionError(result.errors.join(' '));
        }
        if (result.warnings.length > 0) {
          optionsRef.current.onNotice({ level: 'warning', message: result.warnings.join(' ') });
        }
        await optionsRef.current.onMetadataChanged();
      } catch (error) {
        setActionError(getErrorMessage(error));
      } finally {
        mutatingRef.current = false;
        setMutation('idle');
      }

      // The filesystem changed: regenerate. Preview errors go to previewError, never actionError.
      void runPreview(requestRef.current);
    },
    [runPreview],
  );

  const isMutatingNow = useCallback(() => mutatingRef.current, []);

  const canExecute = mutation === 'idle' && isRunnable(shown, request, previewLoading);

  return {
    preview: shown?.result ?? DEFAULT_PREVIEW,
    /** The shown preview was produced by the current request and is not stale. */
    isPreviewCurrent: shown !== null && !shown.stale && shown.request === request,
    previewLoading,
    previewError,
    mutation,
    isMutating: mutation !== 'idle',
    /** Synchronous check (ref-based) for event handlers that may run before the next render. */
    isMutatingNow,
    canExecute,
    actionError,
    setActionError,
    refreshPreview,
    executeRename,
    undoBatch,
  };
}
