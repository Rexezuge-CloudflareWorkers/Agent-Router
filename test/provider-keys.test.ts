import { describe, expect, it } from 'vitest';
import { ProviderKeyService } from '@agent-router/backend-services/provider';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

const MASTER = 'test-master';

function makeService() {
  const keys: Array<Record<string, unknown>> = [];
  const providerDAO = { getById: async () => ({ id: 'p1', userEmail: 'u@x.y' }) };
  const providerKeyDAO = {
    countByProvider: async () => keys.length,
    create: async (row: Record<string, unknown>) =>
      void keys.push({
        ...row,
        id: row.id,
        provider_id: row.providerId,
        encrypted_key: row.encryptedKey,
        key_hint: row.keyHint,
        token_limit: row.tokenLimit,
        request_limit: row.requestLimit,
        reset_at: row.resetAt,
      }),
    getById: async (id: string) => keys.find((k) => k.id === id) ?? null,
    getMetadataById: async (id: string) => {
      const k = keys.find((x) => x.id === id);
      if (!k) return null;
      return {
        id: k.id,
        providerId: k.providerId,
        userEmail: k.userEmail,
        name: k.name,
        keyHint: k.keyHint,
        tokenLimit: k.tokenLimit,
        requestLimit: k.requestLimit,
        usedTokens: 0,
        usedRequests: 0,
        resetAt: k.resetAt,
        priority: k.priority,
        status: 'active',
        cooldownUntil: null,
        consecutiveFailures: 0,
        lastUsedAt: null,
        lastError: null,
        createdAt: 1,
        updatedAt: null,
      };
    },
    listByProvider: async () => [],
    updateMeta: async () => {},
    resetUsage: async () => {},
    delete: async (id: string) => {
      const i = keys.findIndex((k) => k.id === id);
      if (i !== -1) keys.splice(i, 1);
    },
  };
  const env = { DB: {} as never, PROVIDER_KEYS_ENCRYPTION_SECRET: { get: async () => MASTER } };
  const svc = new ProviderKeyService(env, {
    providerDAO: () => Promise.resolve(providerDAO as never),
    providerKeyDAO: () => Promise.resolve(providerKeyDAO as never),
    masterKey: async () => MASTER,
    config: AppConfiguration.fromEnv(env),
  });
  return { svc, keys };
}

describe('ProviderKeyService', () => {
  it('adds keys with encrypted secrets and hints', async () => {
    const { svc, keys } = makeService();
    const created = await svc.addKey('p1', 'u@x.y', {
      name: 'k1',
      secret: 'sk-secret-123',
      tokenLimit: 1000,
      requestLimit: 100,
      resetInDays: 30,
      priority: 5,
    });
    expect(created.name).toBe('k1');
    expect(created.keyHint).toContain('…');
    expect(String(keys[0].encryptedKey)).not.toContain('sk-secret-123');
  });

  it('validates inputs and decrypts secrets', async () => {
    const { svc } = makeService();
    await expect(svc.addKey('p1', 'u@x.y', { name: '', secret: 'sk-x' })).rejects.toThrow();
    await expect(svc.addKey('p1', 'u@x.y', { name: 'k', secret: '' })).rejects.toThrow();
    const created = await svc.addKey('p1', 'u@x.y', { name: 'k', secret: 'sk-abc' });
    const secret = await svc.decryptSecret('p1', created.id, 'u@x.y');
    expect(secret).toBe('sk-abc');
    await svc.deleteKey('p1', created.id, 'u@x.y');
  });
});
