import { describe, expect, it, vi } from 'vitest';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { KeyCrypto } from '@agent-router/backend-services/provider';
import { SearchKeyPoolService, SearchProviderKeyService, SearchProviderService } from '@agent-router/backend-services/search';
import type { SearchKeyCandidate } from '@agent-router/backend-services/search';

const MASTER = 'web-search-master-key';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sk-1',
    provider_id: 'sp-brave',
    user_email: 'u@x.y',
    name: 'Primary',
    encrypted_key: 'cipher',
    key_hint: 'bra…1234',
    request_limit: null,
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
    provider_kind: 'BRAVE',
    ...overrides,
  };
}

describe('SearchProviderService', () => {
  it('creates a named search provider and rejects duplicate or unknown kinds', async () => {
    const stored: Array<Record<string, unknown>> = [];
    const dao = {
      countByUser: async () => stored.length,
      listByUser: async () => stored,
      create: async (input: Record<string, unknown>) => stored.push({ ...input }),
      getById: async (id: string) => stored.find((item) => item.id === id) ?? null,
    };
    const env = { DB: {} as never };
    const service = new SearchProviderService(env, {
      dao: () => Promise.resolve(dao as never),
      config: AppConfiguration.fromEnv(env),
    });
    const created = await service.createProvider('U@X.Y', 'BRAVE', 'Primary Brave');
    expect(created.kind).toBe('BRAVE');
    expect(created.userEmail).toBe('u@x.y');
    await expect(service.createProvider('u@x.y', 'BRAVE', 'primary brave')).rejects.toThrow(/already taken/);
    await expect(service.createProvider('u@x.y', 'GOOGLE', 'Google')).rejects.toThrow(/kind must be one of/);
  });
});

describe('SearchProviderKeyService', () => {
  it('encrypts a search key with the web-search purpose and returns only a hint', async () => {
    const stored: Array<Record<string, unknown>> = [];
    const keyDAO = {
      countByProvider: async () => stored.length,
      create: async (input: Record<string, unknown>) => stored.push(input),
      getMetadataById: async () => ({
        id: 'sk-1',
        providerId: 'sp-brave',
        userEmail: 'u@x.y',
        name: 'Primary',
        keyHint: 'bra…1234',
        requestLimit: 100,
        usedRequests: 0,
        resetAt: null,
        priority: 0,
        status: 'active',
        cooldownUntil: null,
        consecutiveFailures: 0,
        lastUsedAt: null,
        lastError: null,
        createdAt: 1,
        updatedAt: null,
      }),
    };
    const env = { DB: {} as never, WEB_SEARCH_ENCRYPTION_SECRET: { get: async () => MASTER } };
    const service = new SearchProviderKeyService(env, {
      providerDAO: () => Promise.resolve({ getById: async () => ({ id: 'sp-brave', userEmail: 'u@x.y' }) } as never),
      keyDAO: () => Promise.resolve(keyDAO as never),
      masterKey: async () => MASTER,
      config: AppConfiguration.fromEnv(env),
    });
    await service.addKey('sp-brave', 'u@x.y', { name: 'Primary', secret: 'brave-secret-1234', requestLimit: 100 });
    expect(stored).toHaveLength(1);
    expect(stored[0].keyHint).toBe('bra…1234');
    expect(await KeyCrypto.decrypt(stored[0].encryptedKey as string, MASTER, 'web-search-keys')).toBe('brave-secret-1234');
  });
});

describe('SearchKeyPoolService', () => {
  function harness(rows: Array<Record<string, unknown>>) {
    const calls = { success: [] as string[], failure: [] as string[] };
    const dao = {
      listSelectableByUser: async () => rows,
      markExhausted: vi.fn(async () => {}),
      recordSuccess: vi.fn(async () => calls.success.push('sk-1')),
      recordFailure: vi.fn(async () => calls.failure.push('sk-1')),
      markDegraded: vi.fn(async () => calls.failure.push('degraded')),
      disable: vi.fn(async () => calls.failure.push('disabled')),
    };
    const env = { DB: {} as never };
    const pool = new SearchKeyPoolService(env, {
      keyDAO: () => Promise.resolve(dao as never),
      keyService: () => ({ decryptSecret: async () => 'decrypted-key' }) as never,
      config: AppConfiguration.fromEnv(env),
      now: () => 1000,
    });
    return { pool, dao, calls };
  }

  it('selects preferred-provider keys first and stops at the attempt cap', async () => {
    const { pool } = harness([row({ id: 'sk-brave' }), row({ id: 'sk-tavily', provider_kind: 'TAVILY' })]);
    expect(await pool.select('u@x.y', 'sp-brave')).toEqual([
      expect.objectContaining({ keyId: 'sk-brave', kind: 'BRAVE', apiKey: 'decrypted-key' }),
      expect.objectContaining({ keyId: 'sk-tavily', kind: 'TAVILY' }),
    ]);
  });

  it('marks a capped key exhausted and does not offer it', async () => {
    const { pool, dao } = harness([row({ id: 'sk-capped', request_limit: 10, used_requests: 10 }), row({ id: 'sk-ok' })]);
    const candidates = await pool.select('u@x.y', null);
    expect(candidates.map((candidate: SearchKeyCandidate) => candidate.keyId)).toEqual(['sk-ok']);
    expect(dao.markExhausted).toHaveBeenCalledWith('sk-capped', 1000);
  });

  it('degrades on 429 and disables on 401', async () => {
    const { pool, dao } = harness([]);
    const raw = row({ id: 'sk-1' });
    const candidate = {
      keyId: raw.id,
      providerId: raw.provider_id,
      kind: 'BRAVE',
      apiKey: 'brave-key',
      row: raw,
    } as unknown as SearchKeyCandidate;
    await pool.recordFailure(candidate, { status: 429, message: 'rate limited' });
    expect(dao.markDegraded).toHaveBeenCalled();
    expect(dao.recordFailure).not.toHaveBeenCalled();
    await pool.recordFailure(candidate, { status: 401, message: 'invalid key' });
    expect(dao.disable).toHaveBeenCalled();
  });

  it('records a success against the key used', async () => {
    const { pool, calls } = harness([]);
    await pool.recordSuccess('sk-1');
    expect(calls.success).toEqual(['sk-1']);
  });
});
