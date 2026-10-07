import { AlertTriangle, Info, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { IconButton, cn } from './ui';

export interface AppNotice {
  id: number;
  level: 'info' | 'warning' | 'error';
  message: string;
}

/** Dismissable, non-blocking messages (startup notices, rename warnings, plan changes). */
export function NoticeBanner({ notices, onDismiss }: { notices: AppNotice[]; onDismiss: (id: number) => void }) {
  const { t } = useI18n();
  if (notices.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 space-y-1.5" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            notice.level === 'info' && 'border-accent/30 bg-accent/10 text-foreground',
            notice.level === 'warning' && 'border-invalid/30 bg-invalid/10 text-foreground',
            notice.level === 'error' && 'border-conflict/30 bg-conflict/10 text-foreground',
          )}
        >
          {notice.level === 'info' ? (
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <AlertTriangle
              className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', notice.level === 'error' ? 'text-conflict' : 'text-invalid')}
            />
          )}
          <p className="min-w-0 flex-1 whitespace-pre-line">{notice.message}</p>
          <IconButton className="h-5 w-5 shrink-0" onClick={() => onDismiss(notice.id)} aria-label={t('common.dismiss')}>
            <X className="h-3 w-3" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}
