import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Server, Terminal } from 'lucide-react';
import type { Provider, ProviderKey } from '../types';
import {
  addProviderKey,
  createCodexKey,
  createProvider,
  deleteProvider,
  deleteProviderKey,
  disconnectCodexKey,
  importCodexToken,
  listProviderKeys,
  listProviders,
  resetProviderKeyUsage,
  rotateProviderKey,
  updateProviderKey,
} from '../services/providerService';
import { AppPage, PageHeader } from '../components/layout/AppPage';
import { EmptyState } from '../components/layout/PageState';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SkeletonRows } from '../components/ui/Skeleton';
import { ConfirmDialog } from '../components/modals/ConfirmDeleteModal';
import { ProviderCard } from './providers/ProviderCard';
import { AddKeyDialog, AddProviderDialog, CodexDeviceDialog, ImportTokenDialog, RotateKeyDialog } from './providers/ProviderDialogs';
import { useCodexDevice } from './providers/useCodexDevice';

export function ProvidersView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  type PendingDelete = { type: 'provider'; provider: Provider } | { type: 'key'; providerId: string; key: ProviderKey } | null;
  type Dialog =
    | { type: 'provider' }
    | { type: 'key'; provider: Provider }
    | { type: 'rotate'; providerId: string; key: ProviderKey }
    | { type: 'import'; providerId: string; key: ProviderKey }
    | null;
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keysByProvider, setKeysByProvider] = useState<Record<string, ProviderKey[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = async () => {
    try {
      const list = await listProviders();
      setProviders(list);
      const entries = await Promise.all(
        list.map(async (provider) => {
          const keys = await listProviderKeys(provider.id).catch(() => [] as ProviderKey[]);
          return [provider.id, keys] as const;
        }),
      );
      setKeysByProvider(Object.fromEntries(entries));
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('providers.loadFailed', 'Failed to load providers.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mount fetch is the intended sync point
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const device = useCodexDevice({
    onConnected: () => {
      showNotice('success', t('providers.codexConnected', 'Codex account connected.'));
      void reload();
    },
    onError: (message) => showNotice('error', message),
  });

  const run = async (task: () => Promise<unknown>, message: string) => {
    try {
      await task();
      showNotice('success', message);
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('providers.actionFailed', 'Action failed.'));
    }
  };

  const onCreateProvider = async (kind: string, name: string) => {
    try {
      await createProvider(kind, name);
      setDialog(null);
      showNotice('success', t('providers.created', 'Provider created.'));
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('providers.createFailed', 'Failed to create provider.'));
    }
  };

  const onAddKey = async (provider: Provider, input: { name: string; secret: string }) => {
    try {
      if (provider.kind === 'OPENAI_CODEX') {
        await createCodexKey(provider.id, { name: input.name });
        showNotice('success', t('providers.codexKeyAdded', 'Codex key added. Connect it with ChatGPT or import a token.'));
      } else {
        await addProviderKey(provider.id, { name: input.name, secret: input.secret });
        showNotice('success', t('providers.keyAdded', 'Provider key added.'));
      }
      setDialog(null);
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('providers.keyAddFailed', 'Failed to add key.'));
    }
  };

  const onDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.type === 'provider') {
        await deleteProvider(pendingDelete.provider.id);
        showNotice('success', t('providers.deleted', 'Provider deleted.'));
      } else {
        await deleteProviderKey(pendingDelete.providerId, pendingDelete.key.id);
        showNotice('success', t('providers.keyDeleted', 'Key deleted.'));
      }
      setPendingDelete(null);
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('providers.deleteFailed', 'Failed to delete.'));
    } finally {
      setDeleting(false);
    }
  };

  const hasCodex = providers.some((provider) => provider.kind === 'OPENAI_CODEX');

  return (
    <AppPage>
      <PageHeader
        eyebrow={t('header.workspace', 'Workspace')}
        title={t('providers.title', 'Providers')}
        description={t('providers.description', 'Pool multiple upstream keys per provider. Failover is automatic.')}
        actions={
          <Button variant="primary" size="md" onClick={() => setDialog({ type: 'provider' })}>
            <Plus className="h-4 w-4" />
            {t('providers.newProvider', 'New Provider')}
          </Button>
        }
      />

      {!loading && !hasCodex && (
        <Card className="flex items-start gap-3 border-[var(--color-accent)]/25 bg-[var(--color-accent-subtle)]">
          <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent-text)]" />
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t(
              'providers.codexHint',
              'To use ChatGPT OAuth instead of an API key, create an OpenAI Codex (OAuth) provider, add a Codex key, then connect with ChatGPT or import a token.',
            )}
          </p>
        </Card>
      )}

      {loading ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : providers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Server className="h-5 w-5" />}
            title={t('providers.noProviders', 'No providers yet')}
            message={t('providers.noProvidersDescription', 'Add an upstream provider to start routing requests through the gateway.')}
            action={
              <Button variant="primary" size="sm" onClick={() => setDialog({ type: 'provider' })}>
                <Plus className="h-3.5 w-3.5" />
                {t('providers.newProvider', 'New Provider')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              keys={keysByProvider[provider.id] ?? []}
              onAddKey={() => setDialog({ type: 'key', provider })}
              onDeleteProvider={() => setPendingDelete({ type: 'provider', provider })}
              onDeleteKey={(key) => setPendingDelete({ type: 'key', providerId: provider.id, key })}
              onRotateKey={(key) => setDialog({ type: 'rotate', providerId: provider.id, key })}
              onResetKey={(key) => void run(() => resetProviderKeyUsage(provider.id, key.id), t('providers.usageReset', 'Usage reset.'))}
              onToggleKey={(key) =>
                void run(
                  () => updateProviderKey(provider.id, key.id, { status: key.status === 'disabled' ? 'active' : 'disabled' }),
                  t('providers.keyUpdated', 'Key updated.'),
                )
              }
              onConnectCodex={(key) => void device.start(provider.id, key.id)}
              onImportToken={(key) => setDialog({ type: 'import', providerId: provider.id, key })}
              onDisconnectCodex={(key) =>
                void run(() => disconnectCodexKey(provider.id, key.id), t('providers.codexDisconnected', 'Codex disconnected.'))
              }
            />
          ))}
        </div>
      )}

      {dialog?.type === 'provider' && <AddProviderDialog onSubmit={onCreateProvider} onClose={() => setDialog(null)} />}
      {dialog?.type === 'key' && (
        <AddKeyDialog provider={dialog.provider} onSubmit={(input) => onAddKey(dialog.provider, input)} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'rotate' && (
        <RotateKeyDialog
          keyName={dialog.key.name}
          onClose={() => setDialog(null)}
          onSubmit={async (secret) => {
            try {
              await rotateProviderKey(dialog.providerId, dialog.key.id, secret);
              setDialog(null);
              showNotice('success', t('providers.rotated', 'Key rotated.'));
              await reload();
            } catch (error) {
              showNotice('error', error instanceof Error ? error.message : t('providers.actionFailed', 'Action failed.'));
            }
          }}
        />
      )}
      {dialog?.type === 'import' && (
        <ImportTokenDialog
          keyName={dialog.key.name}
          onClose={() => setDialog(null)}
          onSubmit={async (pasted) => {
            try {
              await importCodexToken(dialog.providerId, dialog.key.id, pasted);
              setDialog(null);
              showNotice('success', t('providers.codexTokenImported', 'Codex token imported.'));
              await reload();
            } catch (error) {
              showNotice('error', error instanceof Error ? error.message : t('providers.actionFailed', 'Action failed.'));
            }
          }}
        />
      )}

      {device.session && <CodexDeviceDialog session={device.session} onCancel={device.cancel} />}

      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.type === 'provider' ? t('providers.deleteProvider', 'Delete provider') : t('providers.deleteKey', 'Delete key')
          }
          description={
            pendingDelete.type === 'provider'
              ? t('providers.deleteProviderDescription', 'Delete “{{name}}” and all of its keys? This cannot be undone.', {
                  name: pendingDelete.provider.name,
                })
              : t('providers.deleteKeyDescription', 'Delete the key “{{name}}”? This cannot be undone.', {
                  name: pendingDelete.key.name,
                })
          }
          confirmLabel={t('common.delete', 'Delete')}
          loading={deleting}
          onConfirm={() => void onDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </AppPage>
  );
}
