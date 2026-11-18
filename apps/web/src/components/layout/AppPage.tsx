import { cn } from '../../lib/utils';

type AppPageVariant = 'wide' | 'narrow' | 'hero';

/**
Single standardized page container. `wide` is the default for every view;
`narrow` is reserved for centered forms (New Repository); `hero` is
reserved for the landing hero. Keeps left-edge alignment identical
across page changes.
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
    <div
      className={cn(
        'mx-auto px-6',
        variant === 'wide' && 'max-w-7xl py-8 space-y-4',
        variant === 'narrow' && 'max-w-2xl py-8 space-y-4',
        variant === 'hero' && 'max-w-7xl py-16',
        className,
      )}
    >
      {children}
    </div>
  );
}
