import { Link, useNavigate } from 'react-router-dom';
import { Route } from 'lucide-react';
import { cn } from '../../lib/utils';

export function Header({ userEmail, username }: { userEmail: string | null; username?: string | null }) {
  const navigate = useNavigate();
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface-base)]/95 backdrop-blur">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-5">
          <Link to="/" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Route className="h-5 w-5 text-[var(--color-accent)]" />
            <span>
              <span className="text-[var(--color-accent)]">Agent</span>
              <span className="text-[var(--color-text-primary)]">-Router</span>
            </span>
          </Link>

          {userEmail && (
            <nav className="flex items-center rounded-lg bg-[var(--color-surface-2)] p-1 gap-0.5">
              {[
                { label: 'Dashboard', path: '/' },
                { label: 'Providers', path: '/providers' },
                { label: 'Gateway Keys', path: '/keys' },
                { label: 'Usage', path: '/usage' },
                { label: 'Settings', path: '/settings' },
              ].map((item) => (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={cn(
                    'px-3.5 py-1.5 rounded-md text-sm transition-colors duration-150',
                    'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-sm text-[var(--color-text-muted)] truncate max-w-xs">{username ?? userEmail ?? ''}</div>
        </div>
      </div>
    </header>
  );
}
