import { Card } from '../ui/Card';

/**
Standard page-title header used by Dashboard / Settings / Profile /
Notifications / Snippets: icon avatar + title + description on the left,
actions right-aligned. Replaces the four ad-hoc title-Card variants.
*/
export function PageHeaderCard({
  icon,
  title,
  description,
  actions,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 py-4">
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-surface-3)] shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--color-text-primary)] truncate">{title}</h1>
          {description && <div className="text-sm text-[var(--color-text-muted)] truncate">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3 shrink-0">{actions}</div>}
    </Card>
  );
}
