import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { ModalShell } from './ModalShell';

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell onClose={onCancel} widthClass="w-[calc(100vw-2rem)] max-w-sm" ariaLabel={title}>
      <div className="p-6">
        <div
          className={`mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full ${
            tone === 'danger' ? 'bg-[var(--color-error-bg)]' : 'bg-[var(--color-accent)]/15'
          }`}
        >
          <AlertTriangle
            className={`h-5 w-5 ${tone === 'danger' ? 'text-[var(--color-error-text)]' : 'text-[var(--color-accent-text)]'}`}
          />
        </div>
        <h2 className="mb-2 text-center text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
        <div className="mb-6 text-center text-sm text-[var(--color-text-secondary)]">{description}</div>
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onCancel} disabled={loading}>
            {cancelLabel ?? t('common.cancel', 'Cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} className="flex-1" onClick={onConfirm} loading={loading}>
            {confirmLabel ?? t('common.confirm', 'Confirm')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

export function ConfirmDeleteModal(props: { title: string; displayName: string; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      title={props.title}
      description={t('common.deleteConfirm', 'Delete {{name}}? This cannot be undone.', { name: props.displayName })}
      confirmLabel={t('common.delete', 'Delete')}
      tone="danger"
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
    />
  );
}
