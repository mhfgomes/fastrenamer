import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateChannel, UpdateState } from '@shared/contracts';
import { DEFAULT_UPDATE_STATE } from '../app/defaults';
import { getErrorMessage } from '../app/ipc-errors';
import type { UpdateToastState } from '../app/update-utils';

export type UpdateAction = 'idle' | 'checking' | 'installing';

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** Auto-updater state, actions (with error handling) and the update toast. */
export function useUpdates({ t, onOpenSettings }: { t: Translate; onOpenSettings: () => void }) {
  const [updateState, setUpdateState] = useState<UpdateState>(DEFAULT_UPDATE_STATE);
  const [updateAction, setUpdateAction] = useState<UpdateAction>('idle');
  const [updateToast, setUpdateToast] = useState<UpdateToastState | null>(null);
  const previousUpdateStatus = useRef<UpdateState['status'] | null>(null);
  const updateToastId = useRef(0);
  const onOpenSettingsRef = useRef(onOpenSettings);
  onOpenSettingsRef.current = onOpenSettings;

  const showUpdateToast = useCallback((input: Omit<UpdateToastState, 'id' | 'open'>) => {
    updateToastId.current += 1;
    setUpdateToast({ id: updateToastId.current, open: true, ...input });
  }, []);

  const showFailure = useCallback(
    (error: unknown) => {
      showUpdateToast({
        tone: 'conflict',
        title: t('toast.update_failed.title'),
        description: getErrorMessage(error, t('updates.summary.error')),
        actionLabel: t('toast.open_settings'),
        actionKind: 'open-settings',
      });
    },
    [showUpdateToast, t],
  );

  useEffect(() => {
    let mounted = true;

    const handleUpdateStateChange = (state: UpdateState, notify: boolean) => {
      previousUpdateStatus.current = state.status;
      setUpdateState(state);
      setUpdateAction((current) => {
        if (state.status === 'checking') {
          return current === 'installing' ? current : 'checking';
        }
        if (state.status === 'installing') {
          return 'installing';
        }
        return 'idle';
      });

      if (!notify) {
        return;
      }

      if (state.status === 'available') {
        showUpdateToast({
          tone: 'accent',
          title: t('toast.update_found.title'),
          description: state.manualDownloadOnly
            ? t('toast.update_found.description_manual', { version: state.availableVersion ?? 'unknown' })
            : t('toast.update_found.description_auto', { version: state.availableVersion ?? 'unknown' }),
          actionLabel: state.manualDownloadOnly ? t('updates.download') : t('toast.open_settings'),
          actionKind: state.manualDownloadOnly ? 'download-update' : 'open-settings',
        });
      }

      if (state.status === 'downloaded') {
        showUpdateToast({
          tone: 'ok',
          title: t('toast.update_ready.title'),
          description: t('toast.update_ready.description', { version: state.availableVersion ?? 'unknown' }),
          actionLabel: t('toast.restart_now'),
          actionKind: 'install-update',
        });
      }

      if (state.status === 'error') {
        showUpdateToast({
          tone: 'conflict',
          title: t('toast.update_failed.title'),
          description: state.message ?? t('updates.summary.error'),
          actionLabel: t('toast.open_settings'),
          actionKind: 'open-settings',
        });
      }
    };

    window.advancedRenamer.getUpdateState().then(
      (state) => {
        if (!mounted) {
          return;
        }
        previousUpdateStatus.current = state.status;
        setUpdateState(state);
      },
      () => {
        // Keep the default state; the settings drawer still offers a manual check.
      },
    );

    const unsubscribe = window.advancedRenamer.onUpdateStateChanged((state) => {
      if (!mounted) {
        return;
      }

      const shouldNotify =
        state.status !== previousUpdateStatus.current &&
        (state.status === 'available' || state.status === 'downloaded' || state.status === 'error');

      handleUpdateStateChange(state, shouldNotify);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [showUpdateToast, t]);

  const checkForUpdates = useCallback(async () => {
    setUpdateAction('checking');
    try {
      setUpdateState(await window.advancedRenamer.checkForUpdates());
    } catch (error) {
      showFailure(error);
    } finally {
      setUpdateAction((current) => (current === 'checking' ? 'idle' : current));
    }
  }, [showFailure]);

  const changeUpdateChannel = useCallback(
    async (channel: UpdateChannel) => {
      if (channel === updateState.channel) {
        return;
      }

      setUpdateAction('checking');
      try {
        setUpdateState(await window.advancedRenamer.setUpdateChannel(channel));
      } catch (error) {
        showFailure(error);
      } finally {
        setUpdateAction((current) => (current === 'checking' ? 'idle' : current));
      }
    },
    [showFailure, updateState.channel],
  );

  const installUpdate = useCallback(async () => {
    setUpdateAction('installing');
    try {
      const started = await window.advancedRenamer.quitAndInstallUpdate();
      if (!started) {
        setUpdateAction('idle');
      }
    } catch (error) {
      setUpdateAction('idle');
      showFailure(error);
    }
  }, [showFailure]);

  const openUpdateDownload = useCallback(async () => {
    setUpdateAction('installing');
    try {
      await window.advancedRenamer.openUpdateDownload();
    } catch (error) {
      showFailure(error);
    } finally {
      setUpdateAction('idle');
    }
  }, [showFailure]);

  const setUpdateToastOpen = useCallback((open: boolean) => {
    setUpdateToast((current) => (current ? { ...current, open } : current));
  }, []);

  const handleUpdateToastAction = useCallback(
    (actionKind?: UpdateToastState['actionKind']) => {
      if (!actionKind) {
        return;
      }

      if (actionKind === 'open-settings') {
        onOpenSettingsRef.current();
        setUpdateToastOpen(false);
        return;
      }

      if (actionKind === 'download-update') {
        setUpdateToastOpen(false);
        void openUpdateDownload();
        return;
      }

      void installUpdate();
    },
    [installUpdate, openUpdateDownload, setUpdateToastOpen],
  );

  return {
    updateState,
    updateAction,
    updateToast,
    checkForUpdates,
    changeUpdateChannel,
    installUpdate,
    openUpdateDownload,
    setUpdateToastOpen,
    handleUpdateToastAction,
  };
}
