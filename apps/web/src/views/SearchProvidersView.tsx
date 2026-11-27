import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe2, Plus } from 'lucide-react';
import type { SearchProvider, SearchProviderKey } from '../types';
import {
  addSearchProviderKey,
  createSearchProvider,
  deleteSearchProvider,
  deleteSearchProviderKey,
  listSearchProviderKeys,
  listSearchProviders,
  resetSearchProviderKeyUsage,
  rotateSearchProviderKey,
  updateSearchProviderKey,
} from '../services/searchProviderService';
import { AppPage, PageHeader } from '../components/layout/AppPage';
import { EmptyState } from '../components/layout/PageState';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { SkeletonRows } from '../components/ui/Skeleton';
import { ConfirmDialog } from '../components/modals/ConfirmDeleteModal';
import { SearchProviderCard } from './searchProviders/SearchProviderCard';
import { AddSearchKeyDialog, AddSearchProviderDialog, RotateSearchKeyDialog } from './searchProviders/SearchProviderDialogs';
import type { SearchKeyInput } from './searchProviders/SearchProviderDialogs';

export function SearchProvidersView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  type Dialog =
    | { type: 'provider' }
    | { type: 'key'; provider: SearchProvider }
    | { type: 'rotate'; providerId: string; key: SearchProviderKey }
    | null;
  type PendingDelete = { type: 'provider'; provider: SearchProvider } | { type: 'key'; providerId: string; key: SearchProviderKey } | null;
  const { t } = useTranslation();
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [keysByProvider, setKeysByProvider] = useState<Record<string, SearchProviderKey[]>>({});
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = async () => {
    try {
      const list = await listSearchProviders();
      setProviders(list);
      const entries = await Promise.all(
        list.map(async (provider) => {
          const keys = await listSearchProviderKeys(provider.id).catch(() => [] as SearchProviderKey[]);
          return [provider.id, keys] as const;
        }),
      );
      setKeysByProvider(Object.fromEntries(entries));
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('searchProviders.loadFailed', 'Failed to load search providers.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mount fetch is the intended sync point
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (task: () => Promise<unknown>, message: string) => {
    try {
      await task();
      showNotice('success', message);
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('searchProviders.actionFailed', 'Action failed.'));
    }
  };

  const onCreateProvider = async (kind: string, name: string) => {
    try {
      await createSearchProvider(kind, name);
      setDialog(null);
      showNotice('success', t('searchProviders.created', 'Search provider created.'));
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('searchProviders.createFailed', 'Failed to create search provider.'));
    }
  };

  const onAddKey = async (provider: SearchProvider, input: SearchKeyInput) => {
    try {
      await addSearchProviderKey(provider.id, input);
      setDialog(null);
      showNotice('success', t('searchProviders.keyAdded', 'Search key added.'));
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('searchProviders.keyAddFailed', 'Failed to add key.'));
    }
  };

  const onDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      if (pendingDelete.type === 'provider') {
        await deleteSearchProvider(pendingDelete.provider.id);
        showNotice('success', t('searchProviders.deleted', 'Search provider deleted.'));
      } else {
        await deleteSearchProviderKey(pendingDelete.providerId, pendingDelete.key.id);
        showNotice('success', t('searchProviders.keyDeleted', 'Key deleted.'));
      }
      setPendingDelete(null);
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('searchProviders.deleteFailed', 'Failed to delete.'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AppPage>
      <PageHeader
        eyebrow={t('header.workspace', 'Workspace')}
        title={t('searchProviders.title', 'Search Providers')}
        description={t(
          'searchProviders.description',
          'Pool API keys per search provider. Failed keys cool down and the gateway fails over across your providers.',
        )}
        actions={
          <Button variant="primary" size="md" onClick={() => setDialog({ type: 'provider' })}>
            <Plus className="h-4 w-4" />
            {t('searchProviders.newProvider', 'New Provider')}
          </Button>
        }
      />

      {loading ? (
        <Card>
          <SkeletonRows rows={3} />
        </Card>
      ) : providers.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Globe2 className="h-5 w-5" />}
            title={t('searchProviders.noProviders', 'No search providers yet')}
            message={t('searchProviders.noProvidersDescription', 'Add Brave or Tavily to enable third-party web search.')}
            action={
              <Button variant="primary" size="sm" onClick={() => setDialog({ type: 'provider' })}>
                <Plus className="h-3.5 w-3.5" />
                {t('searchProviders.newProvider', 'New Provider')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {providers.map((provider) => (
            <SearchProviderCard
              key={provider.id}
              provider={provider}
              keys={keysByProvider[provider.id] ?? []}
              onAddKey={() => setDialog({ type: 'key', provider })}
              onDeleteProvider={() => setPendingDelete({ type: 'provider', provider })}
              onDeleteKey={(key) => setPendingDelete({ type: 'key', providerId: provider.id, key })}
              onRotateKey={(key) => setDialog({ type: 'rotate', providerId: provider.id, key })}
              onResetKey={(key) =>
                void run(() => resetSearchProviderKeyUsage(provider.id, key.id), t('searchProviders.usageReset', 'Usage reset.'))
              }
              onToggleKey={(key) =>
                void run(
                  () => updateSearchProviderKey(provider.id, key.id, { status: key.status === 'disabled' ? 'active' : 'disabled' }),
                  t('searchProviders.keyUpdated', 'Key updated.'),
                )
              }
            />
          ))}
        </div>
      )}

      {dialog?.type === 'provider' && <AddSearchProviderDialog onSubmit={onCreateProvider} onClose={() => setDialog(null)} />}
      {dialog?.type === 'key' && (
        <AddSearchKeyDialog
          providerName={dialog.provider.name}
          onSubmit={(input) => onAddKey(dialog.provider, input)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'rotate' && (
        <RotateSearchKeyDialog
          keyName={dialog.key.name}
          onClose={() => setDialog(null)}
          onSubmit={async (secret) => {
            try {
              await rotateSearchProviderKey(dialog.providerId, dialog.key.id, secret);
              setDialog(null);
              showNotice('success', t('searchProviders.rotated', 'Key rotated.'));
              await reload();
            } catch (error) {
              showNotice('error', error instanceof Error ? error.message : t('searchProviders.actionFailed', 'Action failed.'));
            }
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.type === 'provider'
              ? t('searchProviders.deleteProvider', 'Delete search provider')
              : t('searchProviders.deleteKey', 'Delete key')
          }
          description={
            pendingDelete.type === 'provider'
              ? t('searchProviders.deleteProviderDescription', 'Delete “{{name}}” and all of its keys? This cannot be undone.', {
                  name: pendingDelete.provider.name,
                })
              : t('searchProviders.deleteKeyDescription', 'Delete the key “{{name}}”? This cannot be undone.', {
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
