import { useEffect, useState } from 'react';
import { AppPage, PageHeaderCard } from '@rexezuge/web';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import type { CreatedGatewayKey, GatewayKey } from '../types';
import { createGatewayKey, listGatewayKeys, revokeGatewayKey } from '../services/gatewayKeyService';

export function GatewayKeysView({ showNotice }: { showNotice: (type: 'success' | 'error', text: string) => void }) {
  const [keys, setKeys] = useState<GatewayKey[]>([]);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<CreatedGatewayKey | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      setKeys(await listGatewayKeys());
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Load Keys.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial mount fetch is the intended sync point
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCreate = async () => {
    if (!name.trim()) {
      showNotice('error', 'Key Name Is Required.');
      return;
    }
    try {
      const result = await createGatewayKey(name.trim());
      setCreated(result);
      setName('');
      showNotice('success', 'Gateway Key Created. Copy It Now.');
      await reload();
    } catch (error) {
      showNotice('error', error instanceof Error ? error.message : 'Failed To Create Key.');
    }
  };

  return (
    <AppPage>
      <PageHeaderCard title="Gateway Keys" description="Bearer Keys For Your Clients. Use As Authorization: Bearer ar_…" />

      {created && (
        <Card>
          <CardHeader>
            <CardTitle>New Key (Copy Once)</CardTitle>
          </CardHeader>
          <p className="font-mono text-sm break-all rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
            {created.key}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setCreated(null)}>
            Dismiss
          </Button>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>New Key</CardTitle>
        </CardHeader>
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key Name (e.g. Production App)"
            aria-label="Key Name"
          />
          <Button variant="primary" size="sm" onClick={() => void onCreate()}>
            Mint Key
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Keys</CardTitle>
          <span className="text-sm text-[var(--color-text-muted)]">{keys.length}</span>
        </CardHeader>
        {loading ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No Gateway Keys Yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {keys.map((k) => (
              <li key={k.keyId} className="py-2 flex items-center gap-2">
                <span className="text-sm font-medium">{k.name}</span>
                <Badge>{k.status}</Badge>
                <span className="font-mono text-xs text-[var(--color-text-muted)]">{k.keyPrefix}…</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    void revokeGatewayKey(k.keyId)
                      .then(() => reload())
                      .catch((e: unknown) => showNotice('error', e instanceof Error ? e.message : 'Failed.'))
                  }
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </AppPage>
  );
}
