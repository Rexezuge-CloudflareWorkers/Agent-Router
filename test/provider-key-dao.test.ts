import { describe, expect, it } from 'vitest';
import { ProviderKeyDAO } from '@agent-router/backend-data/dao';
import { createFakeD1 } from './helpers/fakeD1';

function rowOf(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    provider_id: 'p1',
    user_email: 'u@x.y',
    name: 'k1',
    encrypted_key: 'enc',
    key_hint: '...hint',
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
    ...overrides,
  };
}

describe('ProviderKeyDAO', () => {
  it('selects only active/degraded, uncooled keys ordered by status then priority', async () => {
    const { database, statements } = createFakeD1(() => [rowOf()]);
    const dao = new ProviderKeyDAO(database);
    await dao.listSelectableByProvider('p1', 100);
    const [statement] = statements;
    expect(statement.query).toContain(`status IN ('active', 'degraded')`);
    expect(statement.query).toContain('cooldown_until IS NULL OR cooldown_until <= ?');
    expect(statement.query).toContain(`CASE status WHEN 'active' THEN 0 ELSE 1 END`);
    expect(statement.bindings).toEqual(['p1', 100]);
  });

  it('records a success and clears failure state', async () => {
    const { database, statements } = createFakeD1();
    const dao = new ProviderKeyDAO(database);
    await dao.recordSuccess('k1', 10, 5, 200);
    const [statement] = statements;
    expect(statement.query).toContain('used_tokens = used_tokens + ?');
    expect(statement.query).toContain('consecutive_failures = 0');
    expect(statement.query).toContain(`status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'active' END`);
    expect(statement.bindings).toEqual([15, 200, 200, 'k1']);
  });

  it('disable writes a parameterized status update', async () => {
    const { database, statements } = createFakeD1();
    const dao = new ProviderKeyDAO(database);
    await dao.disable('k1', 300);
    const [statement] = statements;
    expect(statement.query).toContain(`status = 'disabled'`);
    expect(statement.query).not.toContain('k1');
    expect(statement.bindings).toEqual([300, 'k1']);
  });

  it('rotateSecret replaces the secret and clears failures without interpolating values', async () => {
    const { database, statements } = createFakeD1();
    const dao = new ProviderKeyDAO(database);
    await dao.rotateSecret('k1', { encryptedKey: 'ENC', keyHint: 'hint', status: 'active', now: 400 });
    const [statement] = statements;
    expect(statement.query).toContain('encrypted_key = ?');
    expect(statement.query).toContain('cooldown_until = NULL');
    expect(statement.query).not.toContain('ENC');
    expect(statement.bindings).toEqual(['ENC', 'hint', 'active', 400, 'k1']);
  });

  it('truncates last_error to 500 characters on failure', async () => {
    const { database, statements } = createFakeD1();
    const dao = new ProviderKeyDAO(database);
    await dao.recordFailure('k1', 'x'.repeat(900), 500, 600);
    const [statement] = statements;
    expect((statement.bindings[1] as string).length).toBe(500);
  });

  it('resetDueKeys returns the affected row count', async () => {
    const { database } = createFakeD1(() => ({ changes: 7 }));
    const dao = new ProviderKeyDAO(database);
    await expect(dao.resetDueKeys(100, 500)).resolves.toBe(7);
  });

  it('countByProvider reads the count column', async () => {
    const { database } = createFakeD1(() => ({ count: 4 }));
    const dao = new ProviderKeyDAO(database);
    await expect(dao.countByProvider('p1')).resolves.toBe(4);
  });

  it('updateOAuthRefreshedConditional reports whether the compare-and-swap won', async () => {
    const won = createFakeD1(() => ({ changes: 1 }));
    await expect(
      new ProviderKeyDAO(won.database).updateOAuthRefreshedConditional('k1', 'old', {
        encryptedAccessToken: 'a',
        encryptedRefreshToken: 'r',
        accessExpiresAt: 1,
        now: 2,
      }),
    ).resolves.toBe(true);
    const lost = createFakeD1(() => ({ changes: 0 }));
    await expect(
      new ProviderKeyDAO(lost.database).updateOAuthRefreshedConditional('k1', 'old', {
        encryptedAccessToken: 'a',
        encryptedRefreshToken: 'r',
        accessExpiresAt: 1,
        now: 2,
      }),
    ).resolves.toBe(false);
  });
});
