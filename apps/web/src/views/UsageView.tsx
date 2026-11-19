import { useEffect, useState } from 'react';
import { AppPage, PageHeaderCard } from '@rexezuge/web';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { UsageEntry, UsageSummary } from '../types';
import { getUsageSummary, listUsageLedger } from '../services/usageService';

export function UsageView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    getUsageSummary(30)
      .then(setSummary)
      .catch((error: unknown) => showNotice('error', error instanceof Error ? error.message : 'Failed To Load Usage.'));
    listUsageLedger(50)
      .then(({ entries: rows, nextCursor }) => {
        setEntries(rows);
        setCursor(nextCursor);
      })
      .catch((error: unknown) => showNotice('error', error instanceof Error ? error.message : 'Failed To Load Ledger.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = () => {
    if (!cursor) return;
    listUsageLedger(50, cursor)
      .then(({ entries: rows, nextCursor }) => {
        setEntries((prev) => [...prev, ...rows]);
        setCursor(nextCursor);
      })
      .catch((error: unknown) => showNotice('error', error instanceof Error ? error.message : 'Failed To Load Ledger.'));
  };

  return (
    <AppPage>
      <PageHeaderCard title="Usage" description="Last 30 Days Across All Providers And Keys." />

      <Card>
        <CardHeader>
          <CardTitle>Totals</CardTitle>
        </CardHeader>
        {summary ? (
          <p className="text-sm text-[var(--color-text-secondary)]">
            {summary.totalRequests} Requests · {summary.totalTokens} Tokens ({summary.promptTokens} Prompt / {summary.completionTokens}{' '}
            Completion)
          </p>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Requests</CardTitle>
        </CardHeader>
        {entries.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No Requests Yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {entries.map((e) => (
              <li key={e.id} className="py-2 text-sm flex flex-wrap gap-2">
                <span className="font-mono">{e.upstreamModel ?? '—'}</span>
                <span className="text-[var(--color-text-muted)]">{e.totalTokens} Tokens</span>
                <span className={e.statusCode >= 400 ? 'text-red-500' : 'text-[var(--color-text-muted)]'}>{e.statusCode}</span>
                {e.errorCode && <span className="text-xs text-red-500">{e.errorCode}</span>}
                {e.estimated && <span className="text-xs text-[var(--color-text-muted)]">Estimated</span>}
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <Button variant="secondary" size="sm" onClick={loadMore}>
            Load More
          </Button>
        )}
      </Card>
    </AppPage>
  );
}
