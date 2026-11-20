import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CurrentUser } from '../../types';
import { renameCurrentUsername, loadCurrentUser } from '../../services/userService';
import { Button } from '../ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Field, Input } from '../ui/Input';

export function ProfileSettingsCard({
  user,
  setUser,
  showNotice,
}: {
  user: CurrentUser;
  setUser: (user: CurrentUser) => void;
  showNotice: (type: 'success' | 'error', text: string) => void;
}) {
  const { t } = useTranslation();
  const [newUsername, setNewUsername] = useState(user.username ?? '');
  const [saving, setSaving] = useState(false);

  const trimmedUsername = newUsername.trim();
  const dirtyUsername = trimmedUsername !== '' && trimmedUsername !== (user.username ?? '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirtyUsername) return;
    setSaving(true);
    try {
      const updated = await renameCurrentUsername(trimmedUsername);
      setUser(updated);
      setNewUsername(updated.username ?? '');
      showNotice('success', t('settings.settingsUpdated', 'Profile settings updated.'));
    } catch (error) {
      try {
        const current = await loadCurrentUser();
        setUser(current);
        setNewUsername(current.username ?? '');
      } catch {
        // Ignore refresh failures — the error notice below is authoritative.
      }
      const message = error instanceof Error ? error.message : '';
      showNotice(
        'error',
        message.toLowerCase().includes('reserved')
          ? t('settings.usernameReserved', 'This name is reserved for system use.')
          : error instanceof Error
            ? error.message
            : t('settings.failedToUpdate', 'Failed to update profile.'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('settings.profile', 'Profile')}</CardTitle>
          <CardDescription>{t('settings.profileDescription', 'How you appear across the gateway.')}</CardDescription>
        </div>
      </CardHeader>
      <dl className="mb-5 space-y-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-base)] px-3 py-2.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--color-text-muted)]">{t('settings.email', 'Email')}</dt>
          <dd className="truncate text-[var(--color-text-primary)]">{user.email}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-[var(--color-text-muted)]">{t('settings.username', 'Username')}</dt>
          <dd className="truncate font-mono text-[var(--color-text-primary)]">{user.username ?? '—'}</dd>
        </div>
      </dl>
      <form onSubmit={submit} className="space-y-4">
        <Field
          label={t('settings.username', 'Username')}
          htmlFor="user-username"
          hint={t('settings.renameHint', 'This is your display name inside Agent-Router.')}
        >
          <Input
            id="user-username"
            placeholder={t('settings.usernamePlaceholder', 'your-username')}
            value={newUsername}
            maxLength={39}
            onChange={(e) => setNewUsername(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!dirtyUsername}>
          {t('common.saveChanges', 'Save Changes')}
        </Button>
      </form>
    </Card>
  );
}
