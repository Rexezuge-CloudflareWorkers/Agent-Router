import { Link } from 'react-router-dom';
import { GitBranch } from 'lucide-react';

/**
 * Contextual top bar for every non-root page. The global `Header` renders on
 * `/` only; all other routes render this bar instead, with identical
 * geometry (sticky, `max-w-7xl mx-auto px-6`), so the logo/home anchor never
 * moves between pages. `RepoHeader` reuses it for its title row.
 */
export function ContextBar({ crumb, actions, bare = false }: { crumb: React.ReactNode; actions?: React.ReactNode; bare?: boolean }) {
  const row = (
    <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-3 flex-wrap">
      <Link to="/" aria-label="Agent-Router home" className="flex items-center gap-2 text-xl font-semibold tracking-tight shrink-0">
        <GitBranch className="h-5 w-5 text-[var(--color-accent)]" />
        <span>
          <span className="text-[var(--color-accent)]">Edge</span>
          <span className="text-[var(--color-text-primary)]">-Git</span>
        </span>
      </Link>
      <span aria-hidden="true" className="text-[var(--color-text-muted)] font-normal">
        /
      </span>
      <div className="flex items-center gap-2 min-w-0 flex-1">{crumb}</div>
      {actions && <div className="ml-auto flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
  // `bare` lets composite headers (RepoHeader) share one sticky shell for
  // the title row plus their own second row.
  return bare ? row : <div className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-1)]/95 backdrop-blur">{row}</div>;
}
