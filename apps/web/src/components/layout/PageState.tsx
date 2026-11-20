import { cn } from '../../lib/utils';

/**
Shared loading / empty states so every view renders the same spinner and
the same centered empty message at the same geometry.
*/
export function LoadingSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="min-h-48 flex items-center justify-center" role="status" aria-label={label}>
      <div className="h-8 w-8 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  message?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      {icon && (
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-muted)]">
          {icon}
        </div>
      )}
      {title && <p className="text-sm font-medium text-[var(--color-text-primary)]">{title}</p>}
      {message && <p className="max-w-sm text-sm text-[var(--color-text-muted)]">{message}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
