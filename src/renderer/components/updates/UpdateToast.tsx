import { AlertTriangle, CheckCircle2, Download, Info } from 'lucide-react';
import type { UpdateToastState } from '../../app/update-utils';
import { Toast, ToastAction, ToastClose, ToastDescription, ToastTitle, cn } from '../ui';

export function UpdateToast({
  toast,
  onOpenChange,
  onAction,
}: {
  toast: UpdateToastState;
  onOpenChange: (open: boolean) => void;
  onAction: (actionKind?: UpdateToastState['actionKind']) => void;
}) {
  return (
    <Toast
      open={toast.open}
      onOpenChange={onOpenChange}
      tone={toast.tone}
      duration={toast.actionKind === 'install-update' ? 12000 : 7000}
    >
      <div className="pr-8">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              toast.tone === 'ok' && 'bg-ok/15 text-ok',
              toast.tone === 'accent' && 'bg-accent/15 text-accent',
              toast.tone === 'conflict' && 'bg-conflict/15 text-conflict',
              toast.tone === 'default' && 'bg-surface text-foreground',
            )}
          >
            {toast.tone === 'ok' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : toast.tone === 'conflict' ? (
              <AlertTriangle className="h-4 w-4" />
            ) : toast.actionKind === 'install-update' ? (
              <Download className="h-4 w-4" />
            ) : (
              <Info className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <ToastTitle>{toast.title}</ToastTitle>
            <ToastDescription>{toast.description}</ToastDescription>
          </div>
        </div>
        {toast.actionLabel && (
          <div className="mt-3 flex justify-end">
            <ToastAction altText={toast.actionLabel} onClick={() => onAction(toast.actionKind)}>
              {toast.actionLabel}
            </ToastAction>
          </div>
        )}
      </div>
      <ToastClose />
    </Toast>
  );
}
