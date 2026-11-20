import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap',
    'transition-[background-color,border-color,color,box-shadow] duration-150',
    'disabled:opacity-50 disabled:pointer-events-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface-base)]',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-[var(--color-accent)] text-white shadow-sm hover:bg-[var(--color-accent-dim)]',
        secondary:
          'bg-[var(--color-surface-3)] text-[var(--color-text-primary)] border border-[var(--color-border-muted)] hover:bg-[var(--color-surface-4)]',
        ghost: 'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]',
        outline:
          'bg-transparent text-[var(--color-text-primary)] border border-[var(--color-border-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent-text)]',
        danger: 'bg-[var(--color-error-bg)] text-[var(--color-error-text)] hover:bg-[#3a171a]',
      },
      size: {
        xs: 'h-7 px-2 text-xs gap-1',
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-5 text-sm',
        icon: 'h-8 w-8 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({ className, variant, size, loading, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} {...props}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

export { buttonVariants };
