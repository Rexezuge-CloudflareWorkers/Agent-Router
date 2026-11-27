import { useTranslation } from 'react-i18next';
import { Globe2, KeyRound, Plus, RotateCcw, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/layout/PageState';
import { Progress } from '../../components/ui/Progress';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { formatCompactNumber, formatTimestamp } from '../../lib/format';
import type { SearchProvider, SearchProviderKey } from '../../types';

const KIND_LABELS: Record<string, string> = { BRAVE: 'Brave', TAVILY: 'Tavily' };

function KeyUsage({ item }: { item: SearchProviderKey }) {
  const { t } = useTranslation();
  if (!item.requestLimit) {
    return (
      <p className="text-[11px] text-[var(--color-text-muted)]">
        {formatCompactNumber(item.usedRequests)} {t('searchProviders.reqs', 'reqs')} · {t('searchProviders.noCap', 'no cap')}
      </p>
    );
  }
  return (
    <div className="min-w-40 space-y-0.5">
      <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
        <span>{t('searchProviders.requests', 'Requests')}</span>
        <span className="font-mono">
          {formatCompactNumber(item.usedRequests)} / {formatCompactNumber(item.requestLimit)}
        </span>
      </div>
      <Progress value={item.usedRequests} max={item.requestLimit} label={t('searchProviders.requests', 'Requests')} />
    </div>
  );
}

function KeyNote({ item }: { item: SearchProviderKey }) {
  if (item.lastError) {
    return (
      <p className="max-w-52 truncate text-[11px] text-[var(--color-error-text)]" title={item.lastError}>
        {item.lastError}
      </p>
    );
  }
  if (item.cooldownUntil && item.status !== 'disabled') {
    return <p className="text-[11px] text-[var(--color-warning-text)]">Retry after {formatTimestamp(item.cooldownUntil)}</p>;
  }
  return null;
}

export function SearchProviderCard({
  provider,
  keys,
  onAddKey,
  onDeleteProvider,
  onDeleteKey,
  onRotateKey,
  onResetKey,
  onToggleKey,
}: {
  provider: SearchProvider;
  keys: SearchProviderKey[];
  onAddKey: () => void;
  onDeleteProvider: () => void;
  onDeleteKey: (key: SearchProviderKey) => void;
  onRotateKey: (key: SearchProviderKey) => void;
  onResetKey: (key: SearchProviderKey) => void;
  onToggleKey: (key: SearchProviderKey) => void;
}) {
  const { t } = useTranslation();
  const active = keys.filter((key) => key.status === 'active').length;

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]">
            <Globe2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{provider.name}</h2>
              <Badge variant="accent">{KIND_LABELS[provider.kind] ?? provider.kind}</Badge>
              <StatusBadge status={provider.status} />
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {t('searchProviders.keySummary', '{{active}} of {{total}} keys active', { active, total: keys.length })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onAddKey}>
            <Plus className="h-3.5 w-3.5" />
            {t('searchProviders.addKey', 'Add Key')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDeleteProvider}
            aria-label={t('common.delete', 'Delete')}
            title={t('common.delete', 'Delete')}
          >
            <Trash2 className="h-4 w-4 text-[var(--color-text-muted)]" />
          </Button>
        </div>
      </div>

      <div className="p-5">
        {keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-5 w-5" />}
            title={t('searchProviders.noKeys', 'No keys in this pool')}
            message={t('searchProviders.noKeysDescription', 'Add an API key so web searches can use this provider.')}
            action={
              <Button variant="secondary" size="sm" onClick={onAddKey}>
                <Plus className="h-3.5 w-3.5" />
                {t('searchProviders.addKey', 'Add Key')}
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('searchProviders.key', 'Key')}</TH>
                <TH>{t('searchProviders.status', 'Status')}</TH>
                <TH>{t('searchProviders.usage', 'Usage')}</TH>
                <TH align="right">{t('searchProviders.actions', 'Actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {keys.map((key) => (
                <TR key={key.id}>
                  <TD>
                    <p className="font-medium text-[var(--color-text-primary)]">{key.name}</p>
                    <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
                      {key.keyHint ?? '—'}
                      {key.priority > 0 ? ` · P${key.priority}` : ''}
                    </p>
                    <KeyNote item={key} />
                  </TD>
                  <TD>
                    <StatusBadge status={key.status} />
                  </TD>
                  <TD>
                    <KeyUsage item={key} />
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('searchProviders.resetUsage', 'Reset Usage')}
                        onClick={() => onResetKey(key)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => onToggleKey(key)}
                        title={key.status === 'disabled' ? t('searchProviders.enable', 'Enable') : t('searchProviders.disable', 'Disable')}
                      >
                        {key.status === 'disabled' ? t('searchProviders.enable', 'Enable') : t('searchProviders.disable', 'Disable')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('searchProviders.rotate', 'Rotate Key')}
                        onClick={() => onRotateKey(key)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => onDeleteKey(key)} aria-label={t('common.delete', 'Delete')}>
                        <Trash2 className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>
    </Card>
  );
}
