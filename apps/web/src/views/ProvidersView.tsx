import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppPage, PageHeaderCard } from '@rexezuge/web';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import type { Provider, ProviderKey } from '../types';
import {
  addProviderKey,
  createCodexKey,
  createProvider,
  deleteProvider,
  deleteProviderKey,
  disconnectCodexKey,
  getCodexDeviceStatus,
  importCodexToken,
  listProviderKeys,
  listProviders,
  resetProviderKeyUsage,
  rotateProviderKey,
  startCodexDevice,
  updateProviderKey,
} from '../services/providerService';
import type { CodexDeviceStart } from '../services/providerService';

function usageLabel(key: ProviderKey): string {
  const parts: string[] = [`${key.usedRequests} Reqs`, `${key.usedTokens} Tokens`];
  if (key.requestLimit) parts.push(`/ ${key.requestLimit} Req Cap`);
  if (key.tokenLimit) parts.push(`/ ${key.tokenLimit} Tok Cap`);
  return parts.join(' · ');
}

export function ProvidersView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const { t } = useTranslation();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [keysByProvider, setKeysByProvider] = useState<Record<string, ProviderKey[]>>({});
  const [kind, setKind] = useState('OPENAI');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(true);
  const [keyForm, setKeyForm] = useState<Record<string, { name: string; secret: string }>>({});
  const [deviceByKey, setDeviceByKey] = useState<Record<string, CodexDeviceStart>>({});
  const deviceByKeyRef = useRef<Record<string, CodexDeviceStart>>({});
  const deviceTimers = useRef<Record<string, number | undefined>>({});

  const reload = async () => {
    try {
      const list = await listProviders();
      setProviders(list);
      const entries: Record<string, ProviderKey[]> = {};
      for (const p of list) {
        try {
          entries[p.id] = await listProviderKeys(p.id);
        } catch {
          entries[p.id] = [];
        }
      }
      setKeysByProvider(entries);
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Load Providers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mount fetch is the intended sync point
    void reload();
    const timers = deviceTimers.current;
    return () => {
      for (const id of Object.values(timers)) {
        if (id !== undefined) clearTimeout(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    if (!name.trim()) {
      showNotice('error', 'Provider Name Is Required.');
      return;
    }
    try {
      await createProvider(kind, name.trim());
      setName('');
      showNotice('success', 'Provider Created.');
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Create Provider.');
    }
  };

  const runMutation = (task: Promise<unknown>, okMessage: string): void => {
    void task
      .then(() => {
        showNotice('success', okMessage);
        void reload();
      })
      .catch((error: unknown) => showNotice('error', error instanceof Error ? error.message : 'Failed.'));
  };

  const onRotate = (providerId: string, keyId: string): void => {
    const secret = prompt('Paste Replacement Secret');
    if (secret) runMutation(rotateProviderKey(providerId, keyId, secret), 'Key Rotated.');
  };

  const onAddKey = async (providerId: string): Promise<void> => {
    const form = keyForm[providerId] ?? { name: '', secret: '' };
    if (!form.name.trim() || !form.secret.trim()) {
      showNotice('error', 'Key Name And Secret Are Required.');
      return;
    }
    try {
      await addProviderKey(providerId, { name: form.name.trim(), secret: form.secret.trim() });
      setKeyForm((prev) => ({ ...prev, [providerId]: { name: '', secret: '' } }));
      showNotice('success', 'Provider Key Added.');
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Add Key.');
    }
  };

  const onAddCodexKey = async (providerId: string): Promise<void> => {
    const form = keyForm[providerId] ?? { name: '', secret: '' };
    const name = form.name.trim() || 'Codex OAuth';
    try {
      await createCodexKey(providerId, { name });
      setKeyForm((prev) => ({ ...prev, [providerId]: { name: '', secret: '' } }));
      showNotice('success', t('providers.codexKeyAdded', 'Codex Key Added. Connect It With ChatGPT Or Import A Token.'));
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('providers.codexKeyAddFailed', 'Failed To Add Key.'));
    }
  };

  const clearDevicePoll = (keyId: string): void => {
    const timer = deviceTimers.current[keyId];
    if (timer !== undefined) {
      clearTimeout(timer);
      delete deviceTimers.current[keyId];
    }
    delete deviceByKeyRef.current[keyId];
    setDeviceByKey((prev) => {
      const next = { ...prev };
      delete next[keyId];
      return next;
    });
  };

  const scheduleDevicePoll = (providerId: string, keyId: string, flow: CodexDeviceStart): void => {
    clearDevicePoll(keyId);
    deviceByKeyRef.current[keyId] = flow;
    setDeviceByKey((prev) => ({ ...prev, [keyId]: flow }));
    const delayMs = Math.max(1000, flow.pollIntervalSeconds * 1000);
    deviceTimers.current[keyId] = setTimeout(() => void pollDeviceOnce(providerId, keyId), delayMs);
  };

  const pollDeviceOnce = async (providerId: string, keyId: string): Promise<void> => {
    const current = deviceByKeyRef.current[keyId];
    if (!current) return;
    let status;
    try {
      status = await getCodexDeviceStatus(providerId, keyId);
    } catch {
      // Transient failure: keep polling while the code is still valid.
      scheduleDevicePoll(providerId, keyId, current);
      return;
    }
    switch (status.status) {
      case 'connected': {
        clearDevicePoll(keyId);
        showNotice('success', t('providers.codexConnected', 'Codex Account Connected.'));
        await reload();
        break;
      }
      case 'expired': {
        clearDevicePoll(keyId);
        showNotice('error', t('providers.codexDeviceExpired', 'Codex Authorization Expired. Start Again And Approve Faster.'));
        break;
      }
      case 'failed': {
        clearDevicePoll(keyId);
        showNotice('error', status.message || t('providers.codexAuthFailed', 'Codex Authorization Failed.'));
        break;
      }
      default: {
        scheduleDevicePoll(providerId, keyId, {
          ...current,
          expiresAt: status.expiresAt,
          pollIntervalSeconds: status.pollIntervalSeconds,
        });
        break;
      }
    }
  };

  const onStartDeviceCodex = async (providerId: string, keyId: string): Promise<void> => {
    try {
      const flow = await startCodexDevice(providerId, keyId);
      showNotice('success', t('providers.codexDeviceStarted', 'Enter The Code At OpenAI To Approve.'));
      open(flow.verificationUrl, '_blank', 'noopener');
      scheduleDevicePoll(providerId, keyId, flow);
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : t('providers.codexStartFailed', 'Failed To Start Codex Authorization.'));
    }
  };

  const onCancelDeviceCodex = (keyId: string): void => {
    clearDevicePoll(keyId);
  };

  const onImportCodexToken = (providerId: string, keyId: string): void => {
    const pasted = prompt(t('providers.importTokenPrompt', 'Paste Your Refresh Token Or Auth JSON From The Codex App Or OpenCode'));
    if (pasted) runMutation(importCodexToken(providerId, keyId, pasted), t('providers.codexTokenImported', 'Codex Token Imported.'));
  };

  return (
    <AppPage>
      <PageHeaderCard title="Providers" description="Pool Multiple Upstream Keys Per Provider. Failover Is Automatic." />

      {!loading && providers.every((p) => p.kind !== 'OPENAI_CODEX') && (
        <Card>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {t(
              'providers.codexHint',
              'To Use ChatGPT OAuth Instead Of An API Key, Create An OpenAI Codex (OAuth) Provider, Add A Codex Key, Then Connect With ChatGPT Or Import A Token.',
            )}
          </p>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New Provider</CardTitle>
        </CardHeader>
        <div className="flex flex-wrap gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-sm"
            aria-label="Provider Kind"
          >
            <option value="OPENAI">OpenAI</option>
            <option value="ANTHROPIC">Anthropic</option>
            <option value="GEMINI">Gemini</option>
            <option value="OPENAI_COMPAT">OpenAI Compatible</option>
            <option value="OPENAI_CODEX">{t('providers.codexKindOption', 'OpenAI Codex (OAuth)')}</option>
            <option value="COMMAND_CODE">{t('providers.commandCodeKindOption', 'Command Code')}</option>
          </select>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Provider Name (e.g. Primary OpenAI)"
            aria-label="Provider Name"
          />
          <Button variant="primary" size="sm" onClick={() => void onCreate()}>
            Create
          </Button>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : providers.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-text-secondary)]">No Providers Yet. Create One To Get Started.</p>
        </Card>
      ) : (
        providers.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle>
                {p.name} <span className="text-xs text-[var(--color-text-muted)]">{p.kind}</span>
              </CardTitle>
              <Button variant="secondary" size="sm" onClick={() => runMutation(deleteProvider(p.id), 'Provider Deleted.')}>
                Delete
              </Button>
            </CardHeader>
            <div className="space-y-2">
              {(keysByProvider[p.id] ?? []).map((k) =>
                k.authType === 'codex_oauth' ? (
                  <Fragment key={k.id}>
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] p-2">
                      <span className="text-sm font-medium">{k.name}</span>
                      <Badge>{k.oauthStatus ?? 'pending'}</Badge>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {k.codexAccountId ?? t('providers.notConnected', 'Not Connected')}
                      </span>
                      <span className="text-xs text-[var(--color-text-muted)]">{usageLabel(k)}</span>
                      {k.lastError && <span className="text-xs text-red-500 truncate max-w-xs">{k.lastError}</span>}
                      <span className="ml-auto flex gap-1">
                        {deviceByKey[k.id] === undefined ? (
                          <Button variant="primary" size="sm" onClick={() => void onStartDeviceCodex(p.id, k.id)}>
                            {k.oauthStatus === 'connected'
                              ? t('providers.reconnectCodex', 'Reconnect')
                              : t('providers.connectWithChatGPT', 'Connect With ChatGPT')}
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => onCancelDeviceCodex(k.id)}>
                            {t('providers.cancelAuth', 'Cancel')}
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => onImportCodexToken(p.id, k.id)}>
                          {t('providers.importToken', 'Import Token')}
                        </Button>
                        {k.oauthStatus === 'connected' && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                              runMutation(disconnectCodexKey(p.id, k.id), t('providers.codexDisconnected', 'Codex Disconnected.'))
                            }
                          >
                            Disconnect
                          </Button>
                        )}
                        <Button variant="secondary" size="sm" onClick={() => runMutation(deleteProviderKey(p.id, k.id), 'Key Deleted.')}>
                          Delete
                        </Button>
                      </span>
                    </div>
                    {deviceByKey[k.id] !== undefined && (
                      <div className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          {t('providers.deviceApproveHint', 'Enter This Code At OpenAI To Approve:')}
                        </p>
                        <p className="text-2xl font-mono font-bold tracking-widest">{deviceByKey[k.id]?.userCode}</p>
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={deviceByKey[k.id]?.verificationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-[var(--color-accent)] hover:underline"
                          >
                            {t('providers.openVerificationPage', 'Open Verification Page →')}
                          </a>
                          <Button variant="secondary" size="sm" onClick={() => onCancelDeviceCodex(k.id)}>
                            {t('providers.cancelAuth', 'Cancel')}
                          </Button>
                        </div>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {t('providers.deviceWaiting', 'Waiting For Approval… This Page Updates Automatically.')}
                        </p>
                      </div>
                    )}
                  </Fragment>
                ) : (
                  <div key={k.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] p-2">
                    <span className="text-sm font-medium">{k.name}</span>
                    <Badge>{k.status}</Badge>
                    <span className="text-xs text-[var(--color-text-muted)]">{k.keyHint ?? ''}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{usageLabel(k)}</span>
                    {k.lastError && <span className="text-xs text-red-500 truncate max-w-xs">{k.lastError}</span>}
                    <span className="ml-auto flex gap-1">
                      <Button variant="secondary" size="sm" onClick={() => runMutation(resetProviderKeyUsage(p.id, k.id), 'Usage Reset.')}>
                        Reset Usage
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          runMutation(
                            updateProviderKey(p.id, k.id, { status: k.status === 'disabled' ? 'active' : 'disabled' }),
                            'Key Updated.',
                          )
                        }
                      >
                        {k.status === 'disabled' ? 'Enable' : 'Disable'}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => onRotate(p.id, k.id)}>
                        Rotate
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => runMutation(deleteProviderKey(p.id, k.id), 'Key Deleted.')}>
                        Delete
                      </Button>
                    </span>
                  </div>
                ),
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Input
                  value={keyForm[p.id]?.name ?? ''}
                  onChange={(e) => setKeyForm((prev) => ({ ...prev, [p.id]: { name: e.target.value, secret: prev[p.id]?.secret ?? '' } }))}
                  placeholder="Key Name"
                  aria-label="Key Name"
                />
                {p.kind === 'OPENAI_CODEX' ? (
                  <Button variant="primary" size="sm" onClick={() => void onAddCodexKey(p.id)}>
                    {t('providers.addCodexKey', 'Add Codex Key')}
                  </Button>
                ) : (
                  <>
                    <Input
                      value={keyForm[p.id]?.secret ?? ''}
                      onChange={(e) =>
                        setKeyForm((prev) => ({ ...prev, [p.id]: { name: prev[p.id]?.name ?? '', secret: e.target.value } }))
                      }
                      placeholder="Upstream Secret (sk-…)"
                      aria-label="Upstream Secret"
                    />
                    <Button variant="primary" size="sm" onClick={() => void onAddKey(p.id)}>
                      Add Key
                    </Button>
                  </>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </AppPage>
  );
}
