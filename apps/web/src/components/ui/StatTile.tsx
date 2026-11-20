import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'accent';
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface-2)] to-[var(--color-surface-1)] p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
        {Icon && (
          <span
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg',
              tone === 'accent'
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]'
                : 'bg-[var(--color-surface-3)] text-[var(--color-text-muted)]',
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}
