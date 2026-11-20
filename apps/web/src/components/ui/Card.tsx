import { cn } from '../../lib/utils';

type CardVariant = 'default' | 'subtle' | 'interactive' | 'metric';

const cardVariants: Record<CardVariant, string> = {
  default: 'border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-card',
  subtle: 'border-[var(--color-border)] bg-[var(--color-surface-base)]',
  interactive:
    'border-[var(--color-border)] bg-[var(--color-surface-1)] shadow-card transition-colors duration-150 hover:border-[var(--color-border-muted)] hover:bg-[var(--color-surface-2)]',
  metric: 'border-[var(--color-border)] bg-gradient-to-br from-[var(--color-surface-2)] to-[var(--color-surface-1)] shadow-card',
};

export function Card({
  className,
  variant = 'default',
  children,
}: {
  className?: string;
  variant?: CardVariant;
  children: React.ReactNode;
}) {
  return <div className={cn('min-w-0 rounded-xl border p-5', cardVariants[variant], className)}>{children}</div>;
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex items-center justify-between gap-3 mb-4', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('text-base font-semibold text-[var(--color-text-primary)]', className)}>{children}</h2>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('text-sm text-[var(--color-text-secondary)]', className)}>{children}</p>;
}
