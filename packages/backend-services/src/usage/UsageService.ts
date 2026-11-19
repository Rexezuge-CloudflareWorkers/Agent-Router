import { UsageLedgerDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { TimestampUtil } from '@rexezuge/shared';

interface UsageServiceEnv {
  DB: D1Queryable;
}

interface UsageServiceDeps {
  usageDAO?: () => Promise<UsageLedgerDAO>;
}

class UsageService {
  private readonly deps: Required<UsageServiceDeps>;

  constructor(
    private readonly env: UsageServiceEnv,
    deps: UsageServiceDeps = {},
  ) {
    this.deps = {
      usageDAO: () => Promise.resolve(new UsageLedgerDAO(env.DB)),
      ...deps,
    };
  }

  public async getSummary(
    userEmail: string,
    days = 30,
  ): Promise<{
    totalTokens: number;
    totalRequests: number;
    promptTokens: number;
    completionTokens: number;
    byProvider: Array<{ providerId: string; totalTokens: number; totalRequests: number }>;
  }> {
    const dao = await this.deps.usageDAO();
    const clamped = Math.min(Math.max(days, 1), 90);
    const since = TimestampUtil.getCurrentUnixTimestampInSeconds() - clamped * 86_400;
    const totals = await dao.summarizeByUser(userEmail.toLowerCase(), since);
    const byProvider = await dao.summarizeByProvider(userEmail.toLowerCase(), since);
    return { ...totals, byProvider };
  }

  public async listLedger(
    userEmail: string,
    limit = 50,
    cursor?: string,
  ): Promise<{ entries: Awaited<ReturnType<UsageLedgerDAO['listByUser']>>['rows']; nextCursor: string | null }> {
    const dao = await this.deps.usageDAO();
    const clamped = Math.min(Math.max(limit, 1), 100);
    const { rows, nextCursor } = await dao.listByUser(userEmail.toLowerCase(), clamped, cursor);
    return { entries: rows, nextCursor };
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    const dao = await this.deps.usageDAO();
    return dao.pruneOlderThan(cutoff, limit).catch(() => 0);
  }
}

export { UsageService };
export type { UsageServiceDeps, UsageServiceEnv };
