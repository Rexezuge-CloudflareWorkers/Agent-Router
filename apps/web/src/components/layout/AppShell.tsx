import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BarChart3, KeyRound, LayoutDashboard, Menu, Route, Server, Settings, X } from 'lucide-react';
import type { CurrentUser } from '../../types';
import { cn } from '../../lib/utils';
import { ZERO_TRUST_AUTHENTICATION_PATH } from '../../lib/constants';

const NAV_ITEMS = [
  { key: 'dashboard', path: '/', icon: LayoutDashboard, end: true },
  { key: 'providers', path: '/providers', icon: Server },
  { key: 'keys', path: '/keys', icon: KeyRound },
  { key: 'usage', path: '/usage', icon: BarChart3 },
  { key: 'settings', path: '/settings', icon: Settings },
] as const;

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)]/15 text-[var(--color-accent-text)]">
        <Route className="h-4.5 w-4.5" />
      </span>
      <span>
        <span className="text-[var(--color-text-primary)]">Agent</span>
        <span className="text-[var(--color-accent-text)]">-Router</span>
      </span>
    </NavLink>
  );
}

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
    isActive
      ? 'bg-[var(--color-accent)]/12 text-[var(--color-text-primary)]'
      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-text-primary)]',
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.path} to={item.path} end={'end' in item} className={navLinkClass} onClick={onNavigate}>
          {({ isActive }) => (
            <>
              <item.icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  isActive
                    ? 'text-[var(--color-accent-text)]'
                    : 'text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]',
                )}
              />
              <span>{t(`header.${item.key}`, item.key)}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function UserBlock({ user }: { user: CurrentUser }) {
  const { t } = useTranslation();
  const display = user.username ?? user.email;
  const initial = display.slice(0, 1).toUpperCase();
  return (
    <div className="border-t border-[var(--color-border)] p-3">
      <div className="flex items-center gap-3 rounded-lg px-1 py-1">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-3)] text-xs font-semibold text-[var(--color-text-secondary)]">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{display}</p>
          <p className="truncate text-xs text-[var(--color-text-muted)]">{t('header.signedIn', 'Signed in')}</p>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const { t } = useTranslation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--color-surface-base)]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-1)] md:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            {t('header.workspace', 'Workspace')}
          </p>
          <SidebarNav />
        </div>
        <UserBlock user={user} />
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface-base)]/95 px-4 backdrop-blur md:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? t('common.close', 'Close') : t('common.openMenu', 'Open Menu')}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text-secondary)]"
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button
            type="button"
            aria-label={t('common.close', 'Close')}
            className="absolute inset-0 bg-black/60 animate-backdrop-in"
            onClick={() => setMobileOpen(false)}
          />
          <div
            id="mobile-nav"
            className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-1)] animate-slide-in-left"
          >
            <div className="flex h-14 items-center px-5">
              <Brand />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <SidebarNav onNavigate={() => setMobileOpen(false)} />
            </div>
            <UserBlock user={user} />
          </div>
        </div>
      )}

      <main className="min-w-0 md:pl-60">{children}</main>
    </div>
  );
}

export function AuthShell({ children, showSignIn }: { children: React.ReactNode; showSignIn?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-surface-base)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-surface-base)]/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Brand />
          {showSignIn && (
            <button
              type="button"
              onClick={() => location.assign(ZERO_TRUST_AUTHENTICATION_PATH)}
              className="rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
            >
              {t('common.signIn', 'Sign In')}
            </button>
          )}
        </div>
      </header>
      <main className="min-w-0 flex-1">{children}</main>
      <footer className="border-t border-[var(--color-border)] py-6">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-4 text-xs text-[var(--color-text-muted)] sm:flex-row sm:px-6 lg:px-8">
          <span>Agent-Router</span>
          <span>{t('landing.footer', 'OpenAI, Anthropic, Gemini and Codex behind one gateway.')}</span>
        </div>
      </footer>
    </div>
  );
}
