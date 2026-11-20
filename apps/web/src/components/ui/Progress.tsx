import { cn } from '../../lib/utils';

function toneForRatio(ratio: number): string {
  if (ratio >= 1) return 'bg-[var(--color-error-text)]';
  if (ratio >= 0.85) return 'bg-[var(--color-warning-text)]';
  return 'bg-[var(--color-accent)]';
}

export function Progress({
  value,
  max,
  className,
  label,
}: {
  value: number;
  max: number | null | undefined;
  className?: string;
  label?: string;
}) {
  if (!max || max <= 0) {
    return <span className={cn('text-xs text-[var(--color-text-muted)]', className)}>{label ?? value}</span>;
  }
  const ratio = Math.min(Math.max(value / max, 0), 1);
  return (
    <div className={cn('space-y-1', className)}>
      <div
        role="progressbar"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-4)]"
      >
        <div className={cn('h-full rounded-full transition-all duration-300', toneForRatio(ratio))} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}
