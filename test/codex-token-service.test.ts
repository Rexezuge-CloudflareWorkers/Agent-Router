import { describe, expect, it, vi } from 'vitest';
import { CodexTokenService } from '@agent-router/backend-services/codex';
import { KeyCrypto } from '@agent-router/backend-services/provider';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

const MASTER = 'test-master-key';
const NOW = Math.floor(Date.now() / 1000);

async function enc(secret: string): Promise<string> {
  return KeyCrypto.encrypt(secret, MASTER, 'codex-oauth');
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    provider_id: 'p1',
    user_email: 'u@x.y',
    name: 'Codex',
    encrypted_key: '',
    key_hint: null,
    token_limit: null,
    request_limit: null,
    used_tokens: 0,
    used_requests: 0,
    reset_at: null,
    priority: 0,
    status: 'active',
    cooldown_until: null,
    consecutive_failures: 0,
    last_used_at: null,
    last_error: null,
    created_at: 1,
    updated_at: null,
    auth_type: 'codex_oauth',
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    codex_account_id: 'acc-1',
    access_expires_at: null,
    oauth_status: 'connected',
    ...overrides,
  };
}

function makeService(current: Record<string, unknown>, fetchImpl?: typeof fetch) {
  const events: Array<{ name: string; args: unknown[] }> = [];
  const providerKeyDAO = {
    getById: async () => current,
    setOAuthStatus: async (...args: unknown[]) => void events.push({ name: 'setStatus', args }),
    updateOAuthRefreshedConditional: async (...args: unknown[]) => {
      events.push({ name: 'conditional', args });
      return true;
    },
    updateOAuthRefreshed: async (...args: unknown[]) => void events.push({ name: 'refreshed', args }),
    listOAuthRefreshCandidates: async () => [current],
  };
  const env = { DB: {} as never };
  const svc = new CodexTokenService(env, {
    providerKeyDAO: () => Promise.resolve(providerKeyDAO as never),
    masterKey: async () => MASTER,
    config: AppConfiguration.fromEnv(env),
    fetchImpl,
  });
  return { svc, events, providerKeyDAO };
}

describe('CodexTokenService', () => {
  it('reuses cached access tokens until the validity margin', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 500 }));
    const { svc } = makeService(
      row({ encrypted_access_token: await enc('at-cached'), encrypted_refresh_token: await enc('rt'), access_expires_at: NOW + 3600 }),
      fetchImpl as unknown as typeof fetch,
    );
    const result = await svc.getAccessToken('p1', 'k1', 'u@x.y');
    expect(result.accessToken).toBe('at-cached');
    expect(result.accountId).toBe('acc-1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rotates single-use refresh tokens and persists both halves', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 7200 }, { status: 200 }),
    );
    const { svc, events } = makeService(
      row({ encrypted_refresh_token: await enc('rt-old'), access_expires_at: NOW - 10 }),
      fetchImpl as unknown as typeof fetch,
    );
    const result = await svc.getAccessToken('p1', 'k1', 'u@x.y');
    expect(result.accessToken).toBe('at-new');
    const conditional = events.find((e) => e.name === 'conditional');
    expect(conditional).toBeDefined();
    const patch = (conditional as { args: unknown[] }).args[2] as { encryptedRefreshToken: string };
    expect(await KeyCrypto.decrypt(patch.encryptedRefreshToken, MASTER, 'codex-oauth')).toBe('rt-new');
  });

  it('marks keys revoked on invalid_grant and surfaces a reconnect error', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    const { svc, events } = makeService(
      row({ encrypted_refresh_token: await enc('rt-dead'), access_expires_at: NOW - 10 }),
      fetchImpl as unknown as typeof fetch,
    );
    await expect(svc.getAccessToken('p1', 'k1', 'u@x.y')).rejects.toThrow(/reconnect/i);
    expect(events.some((e) => e.name === 'setStatus' && (e.args as unknown[])[1] === 'revoked')).toBe(true);
  });

  it('falls through to the rotation winner on conditional-update loss', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'at-loser', refresh_token: 'rt-loser' }, { status: 200 }));
    const stale = row({ encrypted_refresh_token: await enc('rt-stale'), access_expires_at: NOW - 5 });
    const winner = row({
      encrypted_access_token: await enc('at-winner'),
      encrypted_refresh_token: await enc('rt-winner'),
      access_expires_at: NOW + 5000,
    });
    let reads = 0;
    const events: string[] = [];
    const providerKeyDAO = {
      getById: async () => {
        reads += 1;
        return reads <= 2 ? stale : winner;
      },
      setOAuthStatus: async () => {},
      updateOAuthRefreshedConditional: async () => {
        events.push('conditional');
        return false;
      },
      updateOAuthRefreshed: async () => void events.push('refreshed'),
      listOAuthRefreshCandidates: async () => [],
    };
    const env = { DB: {} as never };
    const svc = new CodexTokenService(env, {
      providerKeyDAO: () => Promise.resolve(providerKeyDAO as never),
      masterKey: async () => MASTER,
      config: AppConfiguration.fromEnv(env),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const result = await svc.getAccessToken('p1', 'k1', 'u@x.y');
    expect(result.accessToken).toBe('at-winner');
    expect(events).toContain('conditional');
  });

  it('refreshExpiring counts refreshed keys', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'at', refresh_token: 'rt' }, { status: 200 }));
    const { svc } = makeService(
      row({ encrypted_refresh_token: await enc('rt'), access_expires_at: NOW - 60 }),
      fetchImpl as unknown as typeof fetch,
    );
    const summary = await svc.refreshExpiring(50);
    expect(summary.refreshed).toBe(1);
    expect(summary.revoked).toBe(0);
  });
});
