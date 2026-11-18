/**
Shared loading / empty states so every view renders the same spinner and
the same centered empty message at the same geometry.
*/
export function LoadingSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="min-h-64 flex items-center justify-center" role="status" aria-label={label}>
      <div className="h-10 w-10 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
    </div>
  );
}

export function EmptyState({ icon, message }: { icon?: React.ReactNode; message: React.ReactNode }) {
  return (
    <div className="text-center text-[var(--color-text-muted)] py-10 text-sm">
      {icon && <div className="mb-3 flex justify-center">{icon}</div>}
      {message}
    </div>
  );
}
