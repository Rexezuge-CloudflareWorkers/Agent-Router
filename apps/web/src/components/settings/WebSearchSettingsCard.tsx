import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadWebSearchSettings, saveWebSearchSettings } from '../../services/webSearchService';
import type { SearchProviderKind, WebSearchMode, WebSearchSettings } from '../../types';
import { Button } from '../ui/Button';
import { Card, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Field, Input, Select } from '../ui/Input';

const MODES: WebSearchMode[] = ['none', 'native', 'third_party'];
const PROVIDERS: SearchProviderKind[] = ['BRAVE', 'TAVILY'];

export function WebSearchSettingsCard({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<WebSearchSettings | null>(null);
  const [mode, setMode] = useState<WebSearchMode>('none');
  const [provider, setProvider] = useState<SearchProviderKind>('BRAVE');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadWebSearchSettings()
      .then((loaded) => {
        if (cancelled) return;
        setSettings(loaded);
        setMode(loaded.mode);
        setProvider(loaded.provider ?? 'BRAVE');
      })
      .catch(() => {
        if (!cancelled) showNotice('error', t('settings.webSearchLoadFailed', 'Failed to load web search settings.'));
      });
    return () => {
      cancelled = true;
    };
  }, [showNotice, t]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await saveWebSearchSettings({
        mode,
        provider: mode === 'third_party' ? provider : null,
        apiKey: mode === 'third_party' ? apiKey : undefined,
      });
      setSettings(saved);
      setApiKey('');
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
            <Field label={t('settings.webSearchProvider', 'Search Provider')} htmlFor="web-search-provider">
              <Select id="web-search-provider" value={provider} onChange={(event) => setProvider(event.target.value as SearchProviderKind)}>
                {PROVIDERS.map((value) => (
                  <option key={value} value={value}>
                    {value === 'BRAVE' ? 'Brave' : 'Tavily'}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('settings.webSearchApiKey', 'API Key')}
              htmlFor="web-search-api-key"
              hint={
                settings?.keyHint && settings.provider === provider
                  ? t('settings.webSearchStoredKey', 'Stored key: {{hint}}', { hint: settings.keyHint })
                  : t('settings.webSearchKeyHint', 'Leave empty to keep the stored key. The key is encrypted and never shown again.')
              }
            >
              <Input
                id="web-search-api-key"
                type="password"
                autoComplete="off"
                placeholder={t('settings.webSearchApiKeyPlaceholder', 'Paste your API key')}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </Field>
          </>
        )}
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={settings === null}>
          {t('common.saveChanges', 'Save Changes')}
        </Button>
      </form>
    </Card>
  );
}
