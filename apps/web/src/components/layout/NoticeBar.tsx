import { AlertCircle, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

export function NoticeBar({ notice, onDismiss }: { notice: { type: 'success' | 'error'; text: string }; onDismiss?: () => void }) {
  const { t } = useTranslation();
  const statusLabel = notice.type === 'success' ? t('common.success', 'Success') : t('common.error', 'Error');
  const Icon = notice.type === 'success' ? CheckCircle2 : AlertCircle;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-start gap-3 rounded-xl border px-4 py-3 shadow-popover animate-fade-in-up',
        notice.type === 'success'
          ? 'border-[var(--color-success-text)]/25 bg-[var(--color-success-bg)]'
          : 'border-[var(--color-error-text)]/25 bg-[var(--color-error-bg)]',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          notice.type === 'success' ? 'text-[var(--color-success-text)]' : 'text-[var(--color-error-text)]',
        )}
      />
      <div className="min-w-0">
        <span className="sr-only">{statusLabel}: </span>
        <p className={cn('text-sm', notice.type === 'success' ? 'text-[var(--color-success-text)]' : 'text-[var(--color-error-text)]')}>
          {notice.text}
        </p>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.close', 'Close')}
          className="ml-1 shrink-0 rounded-md p-0.5 text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
