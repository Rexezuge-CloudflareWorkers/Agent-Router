import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { loadWebSearchSettings, saveWebSearchSettings } from '../../services/webSearchService';
import { listSearchProviderKeys, listSearchProviders } from '../../services/searchProviderService';
import type { SearchProvider, WebSearchMode, WebSearchSettings } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Field, Select } from '../ui/Input';

const MODES: WebSearchMode[] = ['none', 'native', 'third_party'];

export function WebSearchSettingsCard({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<WebSearchSettings | null>(null);
  const [mode, setMode] = useState<WebSearchMode>('none');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadWebSearchSettings(), listSearchProviders()])
      .then(async ([loaded, list]) => {
        if (cancelled) return;
        setSettings(loaded);
        setMode(loaded.mode);
        setSelectedProviderId(loaded.selectedProviderId ?? '');
        setProviders(list);
        if (!loaded.selectedProviderId) return;
        const keys = await listSearchProviderKeys(loaded.selectedProviderId).catch(() => []);
        if (!cancelled) setKeyHint(keys.find((key) => key.status !== 'disabled')?.keyHint ?? null);
      })
      .catch(() => {
        if (!cancelled) showNotice('error', t('settings.webSearchLoadFailed', 'Failed to load web search settings.'));
      });
    return () => {
      cancelled = true;
    };
  }, [showNotice, t]);

  const onProviderChange = async (id: string) => {
    setSelectedProviderId(id);
    if (!id) {
      setKeyHint(null);
      return;
    }
    const keys = await listSearchProviderKeys(id).catch(() => []);
    setKeyHint(keys.find((key) => key.status !== 'disabled')?.keyHint ?? null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await saveWebSearchSettings({
        mode,
        selectedProviderId: mode === 'third_party' ? selectedProviderId || null : null,
      });
      setSettings(saved);
      showNotice('success', t('settings.webSearchUpdated', 'Web search settings updated.'));
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('settings.webSearchFailed', 'Failed to update web search settings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('settings.webSearch', 'Web Search')}</CardTitle>
          <CardDescription>
            {t('settings.webSearchDescription', 'Choose how web search works for all your gateway requests.')}
          </CardDescription>
        </div>
      </CardHeader>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('settings.webSearchModeLabel', 'Mode')} htmlFor="web-search-mode">
          <Select id="web-search-mode" value={mode} onChange={(event) => setMode(event.target.value as WebSearchMode)}>
            {MODES.map((value) => (
              <option key={value} value={value}>
                {t(
                  `settings.webSearchMode.${value}`,
                  value === 'none' ? 'Off' : value === 'native' ? 'Provider Native' : 'Third-Party API',
                )}
              </option>
            ))}
          </Select>
        </Field>
        {mode === 'third_party' && (
          <>
            <Field
              label={t('settings.webSearchProvider', 'Search Provider')}
              htmlFor="web-search-provider"
              hint={
                keyHint
                  ? t('settings.webSearchStoredKey', 'Stored key: {{hint}}', { hint: keyHint })
                  : t('settings.webSearchKeyHint', 'Keys are managed on the Search Providers page and encrypted at rest.')
              }
            >
              <Select id="web-search-provider" value={selectedProviderId} onChange={(event) => void onProviderChange(event.target.value)}>
                <option value="">{t('settings.webSearchAuto', 'Auto — all active providers')}</option>
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} ({provider.kind})
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-[var(--color-text-secondary)]">
              <Link to="/search-providers" className="text-[var(--color-accent-text)] hover:underline">
                {t('settings.webSearchManageProviders', 'Manage search providers and keys →')}
              </Link>
            </p>
          </>
        )}
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={settings === null}>
          {t('common.saveChanges', 'Save Changes')}
        </Button>
      </form>
    </Card>
  );
}
