import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Gauge, RefreshCw, Timer } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Provider, UsageEntry, UsageSummary } from '../types';
import { getUsageSummary, listUsageLedger } from '../services/usageService';
import { listProviders } from '../services/providerService';
import { AppPage, PageHeader } from '../components/layout/AppPage';
import { EmptyState } from '../components/layout/PageState';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Table, TBody, TD, TH, THead, TR } from '../components/ui/Table';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { SegmentedTabs } from '../components/layout/SegmentedTabs';
import { LoadMoreButton } from '../components/shared/LoadMoreButton';
import { formatCompactNumber, formatDateTime, formatLatency } from '../lib/format';

export function UsageView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  type LedgerFilter = 'all' | 'success' | 'error';
  const { t } = useTranslation();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [summaryResult, ledgerResult, providerList] = await Promise.all([
        getUsageSummary(30),
        listUsageLedger(50),
        listProviders().catch(() => [] as Provider[]),
      ]);
      setSummary(summaryResult);
      setEntries(ledgerResult.entries);
      setCursor(ledgerResult.nextCursor);
      setProviders(providerList);
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('usage.loadFailed', 'Failed to load usage.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mount fetch is the intended sync point
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const result = await listUsageLedger(50, cursor);
      setEntries((prev) => [...prev, ...result.entries]);
      setCursor(result.nextCursor);
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('usage.loadLedgerFailed', 'Failed to load ledger.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const providerName = useMemo(() => {
    const map = new Map(providers.map((provider) => [provider.id, provider.name]));
    return (id: string) => map.get(id) ?? `${id.slice(0, 8)}…`;
  }, [providers]);

  const maxProviderTokens = Math.max(1, ...(summary?.byProvider.map((row) => row.totalTokens) ?? [0]));
  const filteredEntries = entries.filter((entry) =>
    filter === 'all' ? true : filter === 'success' ? entry.statusCode < 400 : entry.statusCode >= 400,
  );
  const finished = (summary?.totalRequests ?? 0) + (summary?.failedRequests ?? 0);
  const successRate = finished === 0 ? null : ((summary?.totalRequests ?? 0) / finished) * 100;

  return (
    <AppPage>
      <PageHeader
        eyebrow={t('header.workspace', 'Workspace')}
        title={t('usage.title', 'Usage')}
        description={t('usage.description', 'Last 30 days across all providers and keys.')}
        actions={
          <Button variant="secondary" size="md" onClick={() => void load()} loading={loading}>
            <RefreshCw className="h-4 w-4" />
            {t('common.refresh', 'Refresh')}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={t('usage.requests', 'Requests')}
          value={formatCompactNumber(summary?.totalRequests)}
          hint={t('usage.failedCount', '{{count}} failed', { count: summary?.failedRequests ?? 0 })}
          icon={Activity}
          tone="accent"
        />
        <StatTile
          label={t('usage.tokens', 'Tokens')}
          value={formatCompactNumber(summary?.totalTokens)}
          hint={`${formatCompactNumber(summary?.promptTokens)} in · ${formatCompactNumber(summary?.completionTokens)} out`}
          icon={BarChart3}
        />
        <StatTile
          label={t('usage.successRate', 'Success rate')}
          value={successRate === null ? '—' : `${successRate.toFixed(1)}%`}
          hint={t('usage.last30Days', 'Last 30 days')}
          icon={Gauge}
        />
        <StatTile
          label={t('usage.avgLatency', 'Avg latency')}
          value={formatLatency(summary?.avgLatencyMs)}
          hint={t('usage.upstream', 'Upstream response time')}
          icon={Timer}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>{t('usage.volume', 'Token volume')}</CardTitle>
              <p className="text-xs text-[var(--color-text-muted)]">{t('usage.volumeHint', 'Successful requests per day')}</p>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-muted)]">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[var(--color-accent)]" />
                {t('usage.tokens', 'Tokens')}
              </span>
            </div>
          </CardHeader>
          {loading ? (
            <SkeletonRows rows={6} />
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={summary?.daily ?? []} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tokenFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    tickFormatter={(value: number) => formatCompactNumber(value)}
                    tick={{ fill: 'var(--color-text-muted)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface-1)',
                      border: '1px solid var(--color-border-muted)',
                      borderRadius: 10,
                      fontSize: 12,
                      color: 'var(--color-text-primary)',
                    }}
                    labelFormatter={(label) => {
                      const day = typeof label === 'string' ? label : '';
                      return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    }}
                    formatter={(value) => [formatCompactNumber(Number(value)), t('usage.tokens', 'Tokens')]}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalTokens"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    fill="url(#tokenFill)"
                    activeDot={{ r: 4, strokeWidth: 0 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('usage.byProvider', 'By provider')}</CardTitle>
          </CardHeader>
          {loading ? (
            <SkeletonRows rows={4} />
          ) : (summary?.byProvider.length ?? 0) === 0 ? (
            <EmptyState message={t('usage.noProviderData', 'No provider traffic in this window.')} />
          ) : (
            <ul className="space-y-3">
              {summary?.byProvider.map((row) => (
                <li key={row.providerId} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate text-[var(--color-text-secondary)]">{providerName(row.providerId)}</span>
                    <span className="shrink-0 font-mono text-[var(--color-text-muted)]">{formatCompactNumber(row.totalTokens)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-4)]">
                    <div
                      className="h-full rounded-full bg-[var(--color-accent)]"
                      style={{ width: `${Math.max(4, (row.totalTokens / maxProviderTokens) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-0">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text-primary)]">{t('usage.recent', 'Recent Requests')}</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{t('usage.recentHint', 'Newest first · upload/download split')}</p>
          </div>
          <SegmentedTabs
            value={filter}
            onChange={(value) => setFilter(value as LedgerFilter)}
            ariaLabel={t('usage.filter', 'Filter requests')}
            tabs={[
              { id: 'all', label: t('usage.filterAll', 'All') },
              { id: 'success', label: t('usage.filterSuccess', 'Success') },
              { id: 'error', label: t('usage.filterError', 'Errors') },
            ]}
          />
        </div>
        <div className="p-5">
          {loading ? (
            <SkeletonRows rows={6} />
          ) : filteredEntries.length === 0 ? (
            <EmptyState
              icon={<BarChart3 className="h-5 w-5" />}
              title={t('usage.noRequests', 'No requests yet')}
              message={t('usage.noRequestsDescription', 'Send a request through the gateway to populate the ledger.')}
            />
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('usage.columnTime', 'Time')}</TH>
                    <TH>{t('usage.columnModel', 'Model')}</TH>
                    <TH>{t('usage.columnProvider', 'Provider')}</TH>
                    <TH>{t('usage.columnStatus', 'Status')}</TH>
                    <TH align="right">{t('usage.columnTokens', 'Tokens')}</TH>
                    <TH align="right">{t('usage.columnLatency', 'Latency')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredEntries.map((entry) => (
                    <TR key={entry.id}>
                      <TD className="whitespace-nowrap text-xs">{formatDateTime(entry.createdAt)}</TD>
                      <TD className="font-mono text-xs text-[var(--color-text-primary)]">{entry.upstreamModel ?? '—'}</TD>
                      <TD className="text-xs">{entry.providerId ? providerName(entry.providerId) : '—'}</TD>
                      <TD>
                        {entry.statusCode >= 400 ? (
                          <Badge variant="error" dot>
                            {entry.errorCode ?? entry.statusCode}
                          </Badge>
                        ) : (
                          <Badge variant="success" dot>
                            {entry.statusCode}
                          </Badge>
                        )}
                      </TD>
                      <TD align="right" className="font-mono text-xs">
                        {formatCompactNumber(entry.totalTokens)}
                        {entry.estimated && <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">~</span>}
                      </TD>
                      <TD align="right" className="whitespace-nowrap text-xs">
                        {formatLatency(entry.latencyMs)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {cursor && (
                <LoadMoreButton onLoadMore={() => void loadMore()} loading={loadingMore} label={t('common.loadMore', 'Load More')} />
              )}
            </>
          )}
        </div>
      </Card>
    </AppPage>
  );
}
