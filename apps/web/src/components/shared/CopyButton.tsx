import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { COPY_FEEDBACK_TIMEOUT_MS } from '../../lib/constants';
import { cn } from '../../lib/utils';

export function CopyButton({
  value,
  label = 'Copy',
  className,
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  size?: 'sm' | 'icon';
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_TIMEOUT_MS);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--color-border-muted)] bg-[var(--color-surface-3)] text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-4)] hover:text-[var(--color-text-primary)]',
        size === 'icon' ? 'h-7 w-7' : 'h-7 px-2',
        className,
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-[var(--color-success-text)]" /> : <Copy className="h-3.5 w-3.5" />}
      {size === 'sm' && <span>{copied ? 'Copied' : label}</span>}
    </button>
  );
}
