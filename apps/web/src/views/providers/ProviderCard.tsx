import { useTranslation } from 'react-i18next';
import { Bot, Gem, KeyRound, Plug, Plus, RotateCcw, RefreshCw, Sparkles, SquareTerminal, Trash2 } from 'lucide-react';
import { Badge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/layout/PageState';
import { Progress } from '../../components/ui/Progress';
import { Table, TBody, TD, TH, THead, TR } from '../../components/ui/Table';
import { formatCompactNumber, formatTimestamp } from '../../lib/format';
import type { Provider, ProviderKey } from '../../types';

const KIND_META: Record<string, { label: string; icon: typeof Sparkles }> = {
  OPENAI: { label: 'OpenAI', icon: Sparkles },
  ANTHROPIC: { label: 'Anthropic', icon: Bot },
  GEMINI: { label: 'Gemini', icon: Gem },
  OPENAI_COMPAT: { label: 'OpenAI compatible', icon: Plug },
  OPENAI_CODEX: { label: 'Codex OAuth', icon: SquareTerminal },
  COMMAND_CODE: { label: 'Command Code', icon: SquareTerminal },
};

function KeyUsage({ item }: { item: ProviderKey }) {
  const { t } = useTranslation();
  return (
    <div className="min-w-40 space-y-1.5">
      {item.requestLimit ? (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
            <span>{t('providers.requests', 'Requests')}</span>
            <span className="font-mono">
              {formatCompactNumber(item.usedRequests)} / {formatCompactNumber(item.requestLimit)}
            </span>
          </div>
          <Progress value={item.usedRequests} max={item.requestLimit} label={t('providers.requests', 'Requests')} />
        </div>
      ) : null}
      {item.tokenLimit ? (
        <div className="space-y-0.5">
          <div className="flex justify-between text-[11px] text-[var(--color-text-muted)]">
            <span>{t('providers.tokens', 'Tokens')}</span>
            <span className="font-mono">
              {formatCompactNumber(item.usedTokens)} / {formatCompactNumber(item.tokenLimit)}
            </span>
          </div>
          <Progress value={item.usedTokens} max={item.tokenLimit} label={t('providers.tokens', 'Tokens')} />
        </div>
      ) : null}
      {item.requestLimit || item.tokenLimit ? null : (
        <p className="text-[11px] text-[var(--color-text-muted)]">
          {formatCompactNumber(item.usedRequests)} {t('providers.reqs', 'reqs')} · {formatCompactNumber(item.usedTokens)}{' '}
          {t('providers.tokensLower', 'tokens')} · {t('providers.noCap', 'no cap')}
        </p>
      )}
    </div>
  );
}

function KeyNote({ item }: { item: ProviderKey }) {
  if (item.lastError) {
    return (
      <p className="max-w-52 truncate text-[11px] text-[var(--color-error-text)]" title={item.lastError}>
        {item.lastError}
      </p>
    );
  }
  if (item.cooldownUntil && (item.status === 'cooling' || item.status === 'disabled')) {
    return (
      <p className="text-[11px] text-[var(--color-warning-text)]">
        {item.status === 'cooling' ? 'Cooling down until ' : 'Retry after '}
        {formatTimestamp(item.cooldownUntil)}
      </p>
    );
  }
  return null;
}

export function ProviderCard({
  provider,
  keys,
  onAddKey,
  onDeleteProvider,
  onDeleteKey,
  onRotateKey,
  onResetKey,
  onToggleKey,
  onConnectCodex,
  onImportToken,
  onDisconnectCodex,
}: {
  provider: Provider;
  keys: ProviderKey[];
  onAddKey: () => void;
  onDeleteProvider: () => void;
  onDeleteKey: (key: ProviderKey) => void;
  onRotateKey: (key: ProviderKey) => void;
  onResetKey: (key: ProviderKey) => void;
  onToggleKey: (key: ProviderKey) => void;
  onConnectCodex: (key: ProviderKey) => void;
  onImportToken: (key: ProviderKey) => void;
  onDisconnectCodex: (key: ProviderKey) => void;
}) {
  const { t } = useTranslation();
  const meta = KIND_META[provider.kind] ?? { label: provider.kind, icon: Plug };
  const Icon = meta.icon;
  const active = keys.filter((key) => key.status === 'active').length;
  const isCodex = provider.kind === 'OPENAI_CODEX';

  return (
    <Card className="p-0">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-3)] text-[var(--color-text-secondary)]">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{provider.name}</h2>
              <Badge variant={isCodex ? 'accent' : 'neutral'}>{meta.label}</Badge>
              <StatusBadge status={provider.status} />
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {t('providers.keySummary', '{{active}} of {{total}} keys active', { active, total: keys.length })}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onAddKey}>
            <Plus className="h-3.5 w-3.5" />
            {isCodex ? t('providers.addCodexKey', 'Add Codex Key') : t('providers.addKey', 'Add Key')}
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
            title={t('providers.noKeys', 'No keys in this pool')}
            message={t('providers.noKeysDescription', 'Add an upstream key so requests can be routed here.')}
            action={
              <Button variant="secondary" size="sm" onClick={onAddKey}>
                <Plus className="h-3.5 w-3.5" />
                {isCodex ? t('providers.addCodexKey', 'Add Codex Key') : t('providers.addKey', 'Add Key')}
              </Button>
            }
          />
        ) : isCodex ? (
          <Table>
            <THead>
              <TR>
                <TH>{t('providers.key', 'Key')}</TH>
                <TH>{t('providers.oauth', 'OAuth')}</TH>
                <TH>{t('providers.account', 'Account')}</TH>
                <TH>{t('providers.usage', 'Usage')}</TH>
                <TH align="right">{t('providers.actions', 'Actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {keys.map((key) => (
                <TR key={key.id}>
                  <TD>
                    <p className="font-medium text-[var(--color-text-primary)]">{key.name}</p>
                    <KeyNote item={key} />
                  </TD>
                  <TD>
                    <StatusBadge status={key.oauthStatus ?? 'pending'} />
                  </TD>
                  <TD className="font-mono text-xs">{key.codexAccountId ?? t('providers.notConnected', 'Not connected')}</TD>
                  <TD>
                    <KeyUsage item={key} />
                  </TD>
                  <TD align="right">
                    <div className="flex justify-end gap-1">
                      <Button variant="secondary" size="xs" onClick={() => onConnectCodex(key)}>
                        {key.oauthStatus === 'connected'
                          ? t('providers.reconnectCodex', 'Reconnect')
                          : t('providers.connectWithChatGPT', 'Connect')}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => onImportToken(key)}>
                        {t('providers.importToken', 'Import Token')}
                      </Button>
                      {key.oauthStatus === 'connected' && (
                        <Button variant="ghost" size="xs" onClick={() => onDisconnectCodex(key)}>
                          {t('providers.disconnect', 'Disconnect')}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" onClick={() => onDeleteKey(key)} aria-label={t('common.delete', 'Delete')}>
                        <Trash2 className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('providers.key', 'Key')}</TH>
                <TH>{t('providers.status', 'Status')}</TH>
                <TH>{t('providers.usage', 'Usage')}</TH>
                <TH align="right">{t('providers.actions', 'Actions')}</TH>
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
                      <Button variant="ghost" size="icon" title={t('providers.resetUsage', 'Reset Usage')} onClick={() => onResetKey(key)}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => onToggleKey(key)}
                        title={key.status === 'disabled' ? t('providers.enable', 'Enable') : t('providers.disable', 'Disable')}
                      >
                        {key.status === 'disabled' ? t('providers.enable', 'Enable') : t('providers.disable', 'Disable')}
                      </Button>
                      <Button variant="ghost" size="icon" title={t('providers.rotate', 'Rotate Key')} onClick={() => onRotateKey(key)}>
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
