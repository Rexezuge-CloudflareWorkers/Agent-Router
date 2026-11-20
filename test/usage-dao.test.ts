import { describe, expect, it } from 'vitest';
import { UsageLedgerDAO } from '@agent-router/backend-data/dao';
import { GatewayKeyDAO } from '@agent-router/backend-data/dao';
import { ProviderDAO } from '@agent-router/backend-data/dao';
import { CursorUtil } from '@agent-router/backend-data/utils/CursorUtil';
import { createFakeD1 } from './helpers/fakeD1';

function usageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    user_email: 'u@x.y',
    gateway_key_id: null,
    provider_id: 'p1',
    provider_key_id: 'k1',
    upstream_model: 'gpt-4o',
    prompt_tokens: 1,
    completion_tokens: 2,
    total_tokens: 3,
    latency_ms: 10,
    status_code: 200,
    error_code: null,
    estimated: 0,
    created_at: 100,
    ...overrides,
  };
}

describe('UsageLedgerDAO', () => {
  it('inserts a row with a server-computed total', async () => {
    const { database, statements } = createFakeD1();
    const dao = new UsageLedgerDAO(database);
    await dao.insert({
      id: 'u1',
      userEmail: 'U@X.Y',
      gatewayKeyId: null,
      providerId: 'p1',
      providerKeyId: 'k1',
      upstreamModel: 'gpt-4o',
      promptTokens: 3,
      completionTokens: 4,
      latencyMs: 12,
      statusCode: 200,
      errorCode: null,
      estimated: false,
      now: 500,
    });
    const [statement] = statements;
    expect(statement.query).toContain('INSERT INTO usage_ledger');
    // total = 3 + 4
    expect(statement.bindings).toContain(7);
    expect(statement.bindings).toContain('u@x.y');
  });

  it('paginates with a keyset cursor and returns the next cursor', async () => {
    // First page: limit 2 → DAO requests 3, gets 3 → hasMore true.
    const { database, statements } = createFakeD1(() => [
      usageRow({ id: 'a', created_at: 300 }),
      usageRow({ id: 'b', created_at: 200 }),
      usageRow({ id: 'c', created_at: 100 }),
    ]);
    const dao = new UsageLedgerDAO(database);
    const page = await dao.listByUser('u@x.y', 2);
    expect(page.rows).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
    expect(statements[0].query).not.toContain('created_at < ?');

    const cursor = page.nextCursor as string;
    const decoded = CursorUtil.decode<{ id: string }>(cursor);
    expect(decoded?.id).toBe('b');

    // Second page uses the compound keyset predicate.
    const second = createFakeD1(() => [usageRow({ id: 'c', created_at: 100 })]);
    await new UsageLedgerDAO(second.database).listByUser('u@x.y', 2, cursor);
    expect(second.statements[0].query).toContain('created_at < ?');
    expect(second.statements[0].bindings[1]).toBe(200);
  });

  it('returns no cursor when the page is not full', async () => {
    const { database } = createFakeD1(() => [usageRow()]);
    const dao = new UsageLedgerDAO(database);
    const page = await dao.listByUser('u@x.y', 5);
    expect(page.nextCursor).toBeNull();
  });

  it('summarizeByUser separates successful tokens from failed requests', async () => {
    const { database } = createFakeD1(() => ({
      totalTokens: 100,
      totalRequests: 3,
      promptTokens: 60,
      completionTokens: 40,
      failedRequests: 2,
      avgLatencyMs: 12.6,
    }));
    const dao = new UsageLedgerDAO(database);
    const summary = await dao.summarizeByUser('u@x.y', 0);
    expect(summary).toMatchObject({ totalTokens: 100, totalRequests: 3, failedRequests: 2 });
    expect(summary.avgLatencyMs).toBe(13);
  });

  it('summarizeDaily filters to successful calls', async () => {
    const { database, statements } = createFakeD1(() => []);
    const dao = new UsageLedgerDAO(database);
    await dao.summarizeDaily('u@x.y', 0);
    expect(statements[0].query).toContain('status_code < 400');
  });

  it('summarizeByProvider drops rows with a null provider id', async () => {
    const { database } = createFakeD1(() => [
      { providerId: 'p1', totalTokens: 5, totalRequests: 1 },
      { providerId: null, totalTokens: 9, totalRequests: 2 },
    ]);
    const dao = new UsageLedgerDAO(database);
    const rows = await dao.summarizeByProvider('u@x.y', 0);
    expect(rows).toEqual([{ providerId: 'p1', totalTokens: 5, totalRequests: 1 }]);
  });
});

describe('GatewayKeyDAO', () => {
  it('getByHash only matches active, unexpired keys', async () => {
    const { database, statements } = createFakeD1(() => ({ key_id: 'g1', user_email: 'u@x.y' }));
    const dao = new GatewayKeyDAO(database);
    await dao.getByHash('hash', 999);
    expect(statements[0].query).toContain(`status = 'active' AND expires_at > ?`);
    expect(statements[0].bindings).toEqual(['hash', 999]);
  });

  it('revoke scopes the update to the owning user', async () => {
    const { database, statements } = createFakeD1();
    const dao = new GatewayKeyDAO(database);
    await dao.revoke('g1', 'U@X.Y');
    expect(statements[0].query).toContain('lower(user_email) = lower(?)');
  });
});

describe('ProviderDAO', () => {
  it('update refuses when the row belongs to another user', async () => {
    const { database, statements } = createFakeD1((s) =>
      s.kind === 'first'
        ? {
            id: 'p1',
            user_email: 'other@x.y',
            name: 'n',
            base_url: null,
            status: 'active',
            kind: 'OPENAI',
            created_at: 1,
            updated_at: null,
          }
        : undefined,
    );
    const dao = new ProviderDAO(database);
    const updated = await dao.update('p1', 'u@x.y', { name: 'n2', now: 5 });
    expect(updated).toBe(false);
    // Only the read ran; no UPDATE issued.
    expect(statements.some((s) => s.query.startsWith('UPDATE'))).toBe(false);
  });

  it('delete always scopes to the owner', async () => {
    const { database, statements } = createFakeD1();
    const dao = new ProviderDAO(database);
    await dao.delete('p1', 'U@X.Y');
    expect(statements[0].query).toBe('DELETE FROM providers WHERE id = ? AND lower(user_email) = lower(?)');
  });
});
