import { cn } from '../../lib/utils';

export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className="-mx-5 overflow-x-auto sm:mx-0">
      <table className={cn('w-full min-w-[640px] border-collapse text-sm', className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-[var(--color-border)] text-left">{children}</thead>;
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-[var(--color-border)]">{children}</tbody>;
}

export function TR({ className, children }: { className?: string; children: React.ReactNode }) {
  return <tr className={cn('transition-colors hover:bg-[var(--color-surface-2)]/60', className)}>{children}</tr>;
}

export function TH({ className, children, align = 'left' }: { className?: string; children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--color-text-muted)]',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({ className, children, align = 'left' }: { className?: string; children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      className={cn('px-3 py-3 align-middle text-[var(--color-text-secondary)]', align === 'right' ? 'text-right' : 'text-left', className)}
    >
      {children}
    </td>
  );
}
