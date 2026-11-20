import { useTranslation } from 'react-i18next';
import { LockKeyhole } from 'lucide-react';
import { ZERO_TRUST_AUTHENTICATION_PATH } from '../../lib/constants';
import { Button } from '../ui/Button';

function authenticateWithZeroTrust() {
  location.assign(ZERO_TRUST_AUTHENTICATION_PATH);
}

export default function Unauthorized({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-center py-20">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)]">
          <LockKeyhole className="h-5 w-5 text-[var(--color-text-muted)]" />
        </div>
        <h1 className="text-base font-semibold text-[var(--color-text-primary)]">{t('unauthorized.title', 'Access Required')}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {message ?? t('unauthorized.defaultMessage', 'You must authenticate to access this page.')}
        </p>
        <Button variant="primary" size="md" className="mt-6" onClick={authenticateWithZeroTrust}>
          {t('unauthorized.action', 'Sign In With Cloudflare Access')}
        </Button>
      </div>
    </div>
  );
}
