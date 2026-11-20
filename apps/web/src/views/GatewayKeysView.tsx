import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, KeyRound, Plus } from 'lucide-react';
import type { CreatedGatewayKey, GatewayKey } from '../types';
import { createGatewayKey, listGatewayKeys, revokeGatewayKey } from '../services/gatewayKeyService';
import { AppPage, PageHeader } from '../components/layout/AppPage';
import { EmptyState } from '../components/layout/PageState';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/modals/ConfirmDeleteModal';
import { ModalHeader, ModalShell } from '../components/modals/ModalShell';
import { Field, Input } from '../components/ui/Input';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { CopyButton } from '../components/shared/CopyButton';
import { formatExpiryTimestamp, formatTimestamp } from '../lib/format';

export function GatewayKeysView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedGatewayKey | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<GatewayKey | null>(null);

  const reload = async () => {
    try {
      setKeys(await listGatewayKeys());
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('keys.loadFailed', 'Failed to load keys.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mount fetch is the intended sync point
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    if (!name.trim()) {
      showNotice('error', t('keys.nameRequired', 'Key name is required.'));
      return;
    }
    setMinting(true);
    try {
      const result = await createGatewayKey(name.trim());
      setCreated(result);
      setName('');
      setDialogOpen(false);
      showNotice('success', t('keys.created', 'Gateway key created. Copy it now.'));
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('keys.createFailed', 'Failed to create key.'));
    } finally {
      setMinting(false);
    }
  };

  const onRevoke = async () => {
    if (!pendingRevoke) return;
    try {
      await revokeGatewayKey(pendingRevoke.keyId);
      setPendingRevoke(null);
      showNotice('success', t('keys.revoked', 'Gateway key revoked.'));
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('keys.revokeFailed', 'Failed to revoke key.'));
    }
  };

  const activeKeys = keys.filter((key) => key.status === 'active');

  return (
    <AppPage>
      <PageHeader
        eyebrow={t('header.workspace', 'Workspace')}
        title={t('keys.title', 'Gateway Keys')}
        description={t('keys.description', 'Bearer keys for your clients. Use them as Authorization: Bearer ar_….')}
        actions={
          <Button variant="primary" size="md" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('keys.mint', 'Mint Key')}
          </Button>
        }
      />

      {created && (
        <Card className="border-[var(--color-success-text)]/30 bg-[var(--color-success-bg)]/40">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-success-text)]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--color-success-text)]">
                {t('keys.copyOnce', 'Copy this key now — it is shown once.')}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-[var(--color-border)] bg-[var(--color-surface-base)] px-3 py-1.5 font-mono text-xs text-[var(--color-text-primary)]">
                  {created.key}
                </code>
                <CopyButton value={created.key} />
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {created.name} · {formatExpiryTimestamp(created.expiresAt)} · {created.prefix}…
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCreated(null)}>
              {t('common.dismiss', 'Dismiss')}
            </Button>
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('keys.active', 'Active Keys')}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{t('keys.count', '{{count}} keys', { count: activeKeys.length })}</p>
          </div>
          <Badge variant="accent">{activeKeys.length}</Badge>
        </div>
        <div className="p-5">
          {loading ? (
            <SkeletonRows rows={4} />
          ) : activeKeys.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="h-5 w-5" />}
              title={t('keys.noKeys', 'No gateway keys yet')}
              message={t('keys.noKeysDescription', 'Mint a key to authenticate your first client request.')}
              action={
                <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                  {t('keys.mint', 'Mint Key')}
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('keys.columnName', 'Name')}</TH>
                  <TH>{t('keys.columnKey', 'Key')}</TH>
                  <TH>{t('keys.columnStatus', 'Status')}</TH>
                  <TH>{t('keys.columnExpires', 'Expires')}</TH>
                  <TH>{t('keys.columnLastUsed', 'Last used')}</TH>
                  <TH align="right">{t('keys.columnActions', 'Actions')}</TH>
                </TR>
              </THead>
              <TBody>
                {activeKeys.map((key) => (
                  <TR key={key.keyId}>
                    <TD className="font-medium text-[var(--color-text-primary)]">{key.name}</TD>
                    <TD>
                      <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-text-secondary)]">
                        {key.keyPrefix}…
                      </code>
                    </TD>
                    <TD>
                      <StatusBadge status={key.status} />
                    </TD>
                    <TD className="whitespace-nowrap text-xs">{formatExpiryTimestamp(key.expiresAt)}</TD>
                    <TD className="whitespace-nowrap text-xs">{formatTimestamp(key.lastUsedAt)}</TD>
                    <TD align="right">
                      {key.status === 'active' && (
                        <Button variant="ghost" size="sm" className="text-[var(--color-error-text)]" onClick={() => setPendingRevoke(key)}>
                          {t('common.revoke', 'Revoke')}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      </Card>

      {dialogOpen && (
        <ModalShell onClose={() => setDialogOpen(false)} widthClass="w-[calc(100vw-2rem)] max-w-md" ariaLabel={t('keys.mint', 'Mint Key')}>
          <ModalHeader title={t('keys.mint', 'Mint Key')} onClose={() => setDialogOpen(false)} />
          <div className="space-y-4 p-5">
            <Field
              label={t('keys.name', 'Key name')}
              htmlFor="gateway-key-name"
              hint={t('keys.nameHint', 'Use a label that identifies the client, e.g. “Production App”.')}
            >
              <Input
                id="gateway-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('keys.namePlaceholder', 'Production App')}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onCreate();
                }}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button variant="primary" size="sm" loading={minting} onClick={() => void onCreate()}>
                {t('keys.mint', 'Mint Key')}
              </Button>
            </div>
          </div>
        </ModalShell>
      )}

      {pendingRevoke && (
        <ConfirmDialog
          title={t('keys.revokeTitle', 'Revoke key')}
          description={t('keys.revokeDescription', 'Revoke “{{name}}”? Clients using it will stop working immediately.', {
            name: pendingRevoke.name,
          })}
          confirmLabel={t('common.revoke', 'Revoke')}
          onConfirm={() => void onRevoke()}
          onCancel={() => setPendingRevoke(null)}
        />
      )}
    </AppPage>
  );
}
