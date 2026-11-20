import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, KeyRound, Server, Sparkles, Activity, ShieldCheck } from 'lucide-react';
import { AppPage, PageHeader } from '../components/layout/AppPage';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { SkeletonRows } from '../components/ui/Skeleton';
import { EmptyState } from '../components/layout/PageState';
import { SegmentedTabs } from '../components/layout/SegmentedTabs';
import { CopyButton } from '../components/shared/CopyButton';
import { listProviders, listProviderKeys } from '../services/providerService';
import { listGatewayKeys } from '../services/gatewayKeyService';
import { getUsageSummary, listUsageLedger } from '../services/usageService';
import type { GatewayKey, Provider, ProviderKey, UsageEntry, UsageSummary } from '../types';
import { formatCompactNumber, formatDateTime } from '../lib/format';

const ENDPOINTS = [
  {
    id: 'openai',
    label: 'OpenAI',
    url: '/v1/chat/completions',
    snippet: `curl $HOST/v1/chat/completions \\
  -H "Authorization: Bearer $AGENT_ROUTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4.1-mini","messages":[{"role":"user","content":"Hello"}]}'`,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    url: '/anthropic/v1/messages',
    snippet: `curl $HOST/anthropic/v1/messages \\
  -H "x-api-key: $AGENT_ROUTER_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"claude-sonnet-4","max_tokens":256,"messages":[{"role":"user","content":"Hello"}]}'`,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    url: '/gemini/v1beta/models/gemini-2.0-flash:generateContent',
    snippet: `curl "$HOST/gemini/v1beta/models/gemini-2.0-flash:generateContent?key=$AGENT_ROUTER_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"contents":[{"parts":[{"text":"Hello"}]}]}'`,
  },
] as const;

const KIND_LABELS: Record<string, string> = {
  OPENAI: 'OpenAI',
  ANTHROPIC: 'Anthropic',
  GEMINI: 'Gemini',
  OPENAI_COMPAT: 'OpenAI compatible',
  OPENAI_CODEX: 'Codex OAuth',
  COMMAND_CODE: 'Command Code',
};

export function DashboardView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keysByProvider, setKeysByProvider] = useState<Record<string, ProviderKey[]>>({});
  const [gatewayKeys, setGatewayKeys] = useState<GatewayKey[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [recent, setRecent] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [endpoint, setEndpoint] = useState<(typeof ENDPOINTS)[number]['id']>('openai');
  const origin = globalThis.location?.origin ?? '';

  useEffect(() => {
    const load = async () => {
      try {
        const [providerList, gatewayList, usage, ledger] = await Promise.all([
          listProviders(),
          listGatewayKeys().catch(() => [] as GatewayKey[]),
          getUsageSummary(30).catch(() => null),
          listUsageLedger(5).catch(() => ({ entries: [] as UsageEntry[], nextCursor: null })),
        ]);
        const keyEntries = await Promise.all(
          providerList.map(async (provider) => {
            const keys = await listProviderKeys(provider.id).catch(() => [] as ProviderKey[]);
            return [provider.id, keys] as const;
          }),
        );
        setProviders(providerList);
        setKeysByProvider(Object.fromEntries(keyEntries));
        setGatewayKeys(gatewayList);
        setSummary(usage);
        setRecent(ledger.entries);
      } catch (error) {
        showNotice('error', error instanceof Error ? error.message : t('dashboard.loadFailed', 'Failed to load dashboard.'));
      } finally {
        setLoading(false);
      }
    };
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allKeys = useMemo(() => Object.values(keysByProvider).flat(), [keysByProvider]);
  const healthyKeys = allKeys.filter((key) => key.status === 'active' || key.status === 'degraded').length;
  const activeGatewayKeys = gatewayKeys.filter((key) => key.status === 'active').length;
  const selected = ENDPOINTS.find((item) => item.id === endpoint) ?? ENDPOINTS[0];

  return (
    <AppPage>
      <PageHeader
        eyebrow={t('dashboard.eyebrow', 'Overview')}
        title={t('dashboard.title', 'Dashboard')}
        description={t('dashboard.description', 'Route OpenAI, Anthropic, Gemini and ChatGPT Codex through one gateway.')}
        actions={
          <Link to="/providers">
            <Button variant="primary" size="md">
              <Server className="h-4 w-4" />
              {t('providers.title', 'Providers')}
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('dashboard.providers', 'Providers')}
          value={providers.length}
          hint={t('dashboard.providersHint', '{{count}} with keys', {
            count: providers.filter((p) => (keysByProvider[p.id]?.length ?? 0) > 0).length,
          })}
          icon={Server}
          tone="accent"
        />
        <StatTile
          label={t('dashboard.keys', 'Provider keys')}
          value={`${healthyKeys}/${allKeys.length}`}
          hint={t('dashboard.keysHint', 'Healthy / total')}
          icon={ShieldCheck}
        />
        <StatTile
          label={t('dashboard.requests', 'Requests · 30d')}
          value={formatCompactNumber(summary?.totalRequests)}
          hint={t('dashboard.failedCount', '{{count}} failed', { count: summary?.failedRequests ?? 0 })}
          icon={Activity}
        />
        <StatTile
          label={t('dashboard.tokens', 'Tokens · 30d')}
          value={formatCompactNumber(summary?.totalTokens)}
          hint={t('dashboard.gatewayKeysHint', '{{count}} gateway keys', { count: activeGatewayKeys })}
          icon={KeyRound}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="items-start">
            <div>
              <CardTitle>{t('dashboard.quickstart', 'Endpoint quickstart')}</CardTitle>
              <p className="text-xs text-[var(--color-text-muted)]">
                {t('dashboard.quickstartHint', 'Point any OpenAI, Anthropic or Gemini client at the gateway.')}
              </p>
            </div>
          </CardHeader>
          <SegmentedTabs
            value={endpoint}
            onChange={(value) => setEndpoint(value as typeof endpoint)}
            ariaLabel={t('dashboard.api', 'API')}
            tabs={ENDPOINTS.map((item) => ({ id: item.id, label: item.label }))}
          />
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-base)] px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--color-text-secondary)]">{`${origin}${selected.url}`}</code>
            <CopyButton value={`${origin}${selected.url}`} size="icon" />
          </div>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-base)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
            <code>{selected.snippet.split('$HOST').join(origin)}</code>
          </pre>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            {t('dashboard.authHint', 'Authenticate with a key from')}{' '}
            <Link to="/keys" className="text-[var(--color-accent-text)] hover:underline">
              {t('keys.title', 'Gateway Keys')}
            </Link>
            {'. '}
            {t('dashboard.pinHint', 'Pin a provider with the x-provider-id header, or let the model name route automatically.')}
          </p>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('dashboard.health', 'Provider health')}</CardTitle>
            <Link to="/providers" className="flex items-center gap-1 text-xs text-[var(--color-accent-text)] hover:underline">
              {t('dashboard.manage', 'Manage')}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          {loading ? (
            <SkeletonRows rows={3} />
          ) : providers.length === 0 ? (
            <EmptyState
              icon={<Server className="h-5 w-5" />}
              title={t('dashboard.noProviders', 'No providers yet')}
              message={t('dashboard.noProvidersDescription', 'Add an upstream provider and a key to start routing.')}
              action={
                <Link to="/providers">
                  <Button variant="primary" size="sm">
                    {t('providers.newProvider', 'New Provider')}
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {providers.map((provider) => {
                const keys = keysByProvider[provider.id] ?? [];
                const active = keys.filter((key) => key.status === 'active').length;
                return (
                  <li key={provider.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{provider.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {KIND_LABELS[provider.kind] ?? provider.kind} · {t('dashboard.keyCount', '{{count}} keys', { count: keys.length })}
                      </p>
                    </div>
                    <Badge variant={provider.status === 'active' && active > 0 ? 'success' : 'neutral'} dot>
                      {provider.status === 'active' ? `${active}/${keys.length}` : provider.status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('dashboard.recent', 'Recent activity')}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{t('dashboard.recentHint', 'Latest requests across all keys')}</p>
          </div>
          <Link to="/usage" className="flex items-center gap-1 text-xs text-[var(--color-accent-text)] hover:underline">
            {t('dashboard.viewUsage', 'View usage')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="p-5">
          {loading ? (
            <SkeletonRows rows={4} />
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<Sparkles className="h-5 w-5" />}
              title={t('dashboard.noActivity', 'No requests yet')}
              message={t('dashboard.noActivityDescription', 'Your first proxied request will show up here.')}
            />
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {recent.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                  <span className="font-mono text-xs text-[var(--color-text-primary)]">{entry.upstreamModel ?? '—'}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{formatDateTime(entry.createdAt)}</span>
                  <span className="text-xs text-[var(--color-text-muted)]">{formatCompactNumber(entry.totalTokens)} tokens</span>
                  <span className="ml-auto">
                    {entry.statusCode >= 400 ? (
                      <Badge variant="error" dot>
                        {entry.errorCode ?? entry.statusCode}
                      </Badge>
                    ) : (
                      <Badge variant="success" dot>
                        {entry.statusCode}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: t('dashboard.codexTitle', 'ChatGPT Codex'),
            description: t('dashboard.codexDescription', 'Connect your ChatGPT account via OAuth. No API key needed.'),
            to: '/providers',
            link: t('dashboard.codexLink', 'Connect Codex'),
          },
          {
            title: t('keys.title', 'Gateway Keys'),
            description: t('dashboard.keysCard', 'Mint bearer keys for your clients. Revoke anytime.'),
            to: '/keys',
            link: t('dashboard.manageKeys', 'Manage keys'),
          },
          {
            title: t('usage.title', 'Usage'),
            description: t('dashboard.usageCard', 'Token totals and a per-request ledger for debugging failover.'),
            to: '/usage',
            link: t('dashboard.viewUsage', 'View usage'),
          },
        ].map((card) => (
          <Card key={card.title} variant="interactive">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">{card.title}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{card.description}</p>
            <Link
              to={card.to}
              className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent-text)] hover:underline"
            >
              {card.link}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        ))}
      </div>
    </AppPage>
  );
}
