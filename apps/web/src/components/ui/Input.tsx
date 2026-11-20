import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const fieldBase =
  'w-full rounded-lg bg-[var(--color-surface-base)] border border-[var(--color-border)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] transition-colors duration-150 focus:outline-none focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/25 disabled:opacity-60';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-9 px-3 py-2 text-sm', className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select className={cn(fieldBase, 'h-9 appearance-none pl-3 pr-9 py-2 text-sm cursor-pointer')} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]"
      />
    </div>
  );
}

export function Label({ className, children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('block text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]', className)} {...props}>
      {children}
    </label>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'px-3 py-2 text-sm', className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}
