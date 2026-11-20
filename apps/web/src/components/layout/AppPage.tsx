import { cn } from '../../lib/utils';
import { AppPage as KitAppPage } from '@rexezuge/web';

type AppPageVariant = 'wide' | 'narrow' | 'hero';

/**
Single standardized page container. Wraps the kit's `AppPage` so the router
keeps one wider default (`max-w-7xl`) across every authenticated view while
the narrow/hero variants stay available for forms and the landing page.
*/
export function AppPage({
  variant = 'wide',
  className,
  children,
}: {
  variant?: AppPageVariant;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <KitAppPage
      variant={variant}
      className={cn('max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8', variant === 'hero' && 'py-12 lg:py-16', className)}
    >
      {children}
    </KitAppPage>
  );
}

/**
Shared page title block: icon-free, with an optional action row.
*/
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--color-accent-text)]">{eyebrow}</p>}
        <h1 className="text-xl font-semibold tracking-tight text-[var(--color-text-primary)] sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-secondary)]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}
