import { describe, expect, it, vi } from 'vitest';
import type { Container } from '@agent-router/backend-runtime/di';
import { CodexTokenRefreshTask, GatewayKeyPruningTask, UsageResetTask, UsagePruneTask } from '@agent-router/background/scheduled';

/**
Cron tasks are exercised through an injected fake scope: each task must call
the exact service method (and swallow/log its own failures) without a real D1.
*/

const ENV = {
  DB: {},
  KEY_MAX_CONSECUTIVE_FAILURES: '10',
  USAGE_RETENTION_DAYS: '90',
  CODEX_REFRESH_BATCH_SIZE: '50',
  ENVIRONMENT: 'production',
} as unknown as Env;

function fakeScope(services: Record<string, unknown>): (env: Env) => Container {
  return () =>
    ({
      get: (token: unknown) => {
        const key = String(token);
        const match = Object.entries(services).find(([name]) => key.includes(name));
        if (!match) throw new Error(`no service for ${key}`);
        return match[1];
      },
    }) as unknown as Container;
}

describe('cron tasks', () => {
  it('GatewayKeyPruningTask prunes expired keys', async () => {
    const pruneExpired = vi.fn(async () => 3);
    const factory = fakeScope({ GatewayKeyService: { pruneExpired } });
    const task = new GatewayKeyPruningTask(factory);
    await task.run(ENV);
    expect(pruneExpired).toHaveBeenCalledWith(expect.any(Number), 500);
  });

  it('UsageResetTask calls resetDueKeys and tolerates failure', async () => {
    const resetDueKeys = vi.fn(async () => {
      throw new Error('db down');
    });
    // DAO tokens resolve to a factory (scope.get(Token)()), not the DAO itself.
    const factory = fakeScope({ ProviderKeyDAO: () => Promise.resolve({ resetDueKeys }) });
    const task = new UsageResetTask(factory);
    // A DB error is caught inside the task (returns 0); run still resolves.
    await expect(task.run(ENV)).resolves.toBeUndefined();
    expect(resetDueKeys).toHaveBeenCalled();
  });

  it('CodexTokenRefreshTask refreshes and prunes sessions', async () => {
    const refreshExpiring = vi.fn(async () => ({ refreshed: 2, revoked: 0 }));
    const deleteExpiredOrConsumed = vi.fn(async () => 1);
    const factory = fakeScope({
      CodexTokenService: { refreshExpiring },
      CodexDeviceSessionDAO: () => Promise.resolve({ deleteExpiredOrConsumed }),
    });
    const task = new CodexTokenRefreshTask(factory);
    await task.run(ENV);
    expect(refreshExpiring).toHaveBeenCalledWith(50);
    expect(deleteExpiredOrConsumed).toHaveBeenCalledWith(expect.any(Number), 500);
  });

  it('UsagePruneTask prunes the ledger past retention', async () => {
    const pruneOlderThan = vi.fn(async () => 4);
    const factory = fakeScope({ UsageService: { pruneOlderThan } });
    const task = new UsagePruneTask(factory);
    await task.run(ENV);
    expect(pruneOlderThan).toHaveBeenCalledWith(expect.any(Number), 500);
  });
});
