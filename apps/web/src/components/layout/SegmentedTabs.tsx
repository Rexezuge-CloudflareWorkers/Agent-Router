import { cn } from '../../lib/utils';

export interface SegmentTab {
  id: string;
  label: string;
  count?: number;
}

/**
The single tab pattern for the whole SPA (pill segmented control, taken
from the Header/Profile style). Replaces the Repo underline tabs and the
Search dot-separated buttons so similar elements sit in the same place.
*/
export function SegmentedTabs({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: SegmentTab[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      role="tablist"
      className="flex items-center gap-1 rounded-lg bg-[var(--color-surface-2)] p-1 w-fit max-w-full overflow-x-auto"
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            'px-3.5 py-1.5 rounded-md text-sm transition-colors duration-150 whitespace-nowrap',
            value === t.id
              ? 'bg-[var(--color-surface-1)] text-[var(--color-text-primary)]'
              : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 text-xs text-[var(--color-text-muted)]">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
