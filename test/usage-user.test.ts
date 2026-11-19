import { describe, expect, it } from 'vitest';
import { UsageService } from '@agent-router/backend-services/usage';
import { UserService } from '@agent-router/backend-services/user';

describe('UsageService', () => {
  it('summarizes and lists ledger', async () => {
    const usageDAO = {
      summarizeByUser: async () => ({ totalTokens: 100, totalRequests: 5, promptTokens: 60, completionTokens: 40 }),
      summarizeByProvider: async () => [{ providerId: 'p1', totalTokens: 100, totalRequests: 5 }],
      listByUser: async () => ({ rows: [], nextCursor: null }),
      pruneOlderThan: async () => 3,
    };
    const svc = new UsageService({ DB: {} as never }, { usageDAO: () => Promise.resolve(usageDAO as never) });
    const summary = await svc.getSummary('u@x.y', 30);
    expect(summary.totalTokens).toBe(100);
    expect(await svc.pruneOlderThan(1, 10)).toBe(3);
  });
});

describe('UserService', () => {
  it('upserts and renames usernames', async () => {
    let stored: { email: string; username: string | null } | null = null;
    const userDAO = {
      upsertUser: async (email: string) => {
        if (!stored) stored = { email, username: null };
      },
      getByEmail: async () => stored,
      getByUsernameCi: async () => null,
      ensureUsername: async (_e: string, u: string) => {
        if (stored) stored.username = u;
      },
      setUsername: async (_e: string, u: string) => {
        if (stored) stored.username = u;
      },
    };
    const svc = new UserService({ DB: {} as never }, { userDAO: () => Promise.resolve(userDAO as never) });
    await svc.upsertUser('New@Example.com');
    expect((stored as { username: string | null } | null)?.username).toBeTruthy();
    const renamed = await svc.renameUsername('new@example.com', 'new-handle');
    expect(renamed.username).toBe('new-handle');
    await expect(svc.renameUsername('new@example.com', '!!!')).rejects.toThrow();
  });
});
