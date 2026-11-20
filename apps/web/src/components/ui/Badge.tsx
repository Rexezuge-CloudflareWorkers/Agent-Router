import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium leading-5 shrink-0 border', {
  variants: {
    variant: {
      success: 'bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-text)]/15',
      error: 'bg-[var(--color-error-bg)] text-[var(--color-error-text)] border-[var(--color-error-text)]/15',
      warning: 'bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-text)]/15',
      info: 'bg-[var(--color-info-bg)] text-[var(--color-info-text)] border-[var(--color-info-text)]/15',
      neutral: 'bg-[var(--color-neutral-bg)] text-[var(--color-neutral-text)] border-[var(--color-border)]',
      accent: 'bg-[var(--color-accent)]/12 text-[var(--color-accent-text)] border-[var(--color-accent)]/25',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>['variant']>;

export function Badge({
  className,
  variant,
  dot,
  children,
}: {
  className?: string;
  dot?: boolean;
  children: React.ReactNode;
} & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)}>
      {dot && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  active: 'success',
  connected: 'success',
  degraded: 'warning',
  cooling: 'info',
  pending: 'warning',
  exhausted: 'error',
  expired: 'error',
  revoked: 'neutral',
  disabled: 'neutral',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'neutral'} dot className={cn('capitalize', className)}>
      {status}
    </Badge>
  );
}
