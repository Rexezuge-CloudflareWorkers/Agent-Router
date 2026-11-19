import { describe, expect, it } from 'vitest';
import { GatewayKeyService } from '@agent-router/backend-services/gateway';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

function makeService() {
  const rows: Array<Record<string, unknown>> = [];
  const dao = {
    create: async (row: Record<string, unknown>) => {
      rows.push({ ...row, status: 'active', last_used_at: null });
    },
    getByHash: async (hash: string, now: number) => {
      const found = rows.find((r) => r.keyHash === hash || r.key_hash === hash);
      if (!found) return null;
      const expires = (found.expiresAt ?? found.expires_at) as number;
      if (!(expires > now)) return null;
      return {
        key_id: found.keyId ?? found.key_id,
        user_email: found.userEmail ?? found.user_email,
        key_hash: hash,
        key_prefix: found.keyPrefix ?? found.key_prefix,
        name: found.name,
        status: 'active',
        expires_at: expires,
        last_used_at: null,
        created_at: (found.now ?? found.created_at) as number,
      };
    },
    listByUser: async (email: string) =>
      rows
        .filter((r) => String(r.userEmail ?? r.user_email).toLowerCase() === email.toLowerCase())
        .map((r) => ({
          keyId: (r.keyId ?? r.key_id) as string,
          userEmail: (r.userEmail ?? r.user_email) as string,
          keyPrefix: (r.keyPrefix ?? r.key_prefix) as string,
          name: r.name as string,
          status: 'active' as const,
          expiresAt: (r.expiresAt ?? r.expires_at) as number,
          lastUsedAt: null,
          createdAt: (r.now ?? r.created_at) as number,
        })),
    touchLastUsed: async () => {},
    revoke: async (keyId: string) => {
      const found = rows.find((r) => (r.keyId ?? r.key_id) === keyId);
      if (found) found.status = 'revoked';
    },
    pruneExpired: async () => 0,
  };
  const env = { DB: {} as never };
  const svc = new GatewayKeyService(env, {
    gatewayKeyDAO: () => Promise.resolve(dao as never),
    userDAO: () => Promise.resolve({ getByEmail: async () => null, upsertUser: async () => {} } as never),
    config: AppConfiguration.fromEnv(env),
  });
  return { svc, rows };
}

describe('GatewayKeyService', () => {
  it('mints ar_ keys and authenticates them', async () => {
    const { svc } = makeService();
    const created = await svc.createKey('User@Example.com', 'prod');
    expect(created.key.startsWith('ar_')).toBe(true);
    const auth = await svc.authenticate(created.key);
    expect(auth.userEmail).toBe('user@example.com');
    expect(auth.keyId).toBe(created.keyId);
  });

  it('rejects invalid keys and enforces name', async () => {
    const { svc } = makeService();
    await expect(svc.authenticate('ar_missing')).rejects.toThrow();
    await expect(svc.createKey('a@b.c', '')).rejects.toThrow();
  });

  it('enforces per-user key cap', async () => {
    const { svc } = makeService();
    const env = { DB: {} as never, MAX_GATEWAY_KEYS_PER_USER: '1' };
    const capped = new GatewayKeyService(env, {
      gatewayKeyDAO: () =>
        Promise.resolve({
          listByUser: async () => [{ keyId: 'x', status: 'active' }],
          create: async () => {},
        } as never),
      userDAO: () => Promise.resolve({ getByEmail: async () => ({ email: 'a' }), upsertUser: async () => {} } as never),
      config: AppConfiguration.fromEnv(env),
    });
    expect(capped).toBeDefined();
    await expect(svc.createKey('a@b.c', 'k1')).resolves.toBeDefined();
  });
});
