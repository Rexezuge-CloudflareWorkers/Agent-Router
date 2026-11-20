import { UsageLedgerDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { TimestampUtil } from '@rexezuge/shared';

interface UsageServiceEnv {
  DB: D1Queryable;
}

interface UsageServiceDeps {
  usageDAO?: () => Promise<UsageLedgerDAO>;
}

function utcDay(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

/**
Chart-ready series: the DAO only returns days with traffic, so fill the gaps
with zeroes to keep the x-axis continuous over the requested window.
*/
function fillMissingDays(
  rows: Array<{ day: string; totalTokens: number; totalRequests: number }>,
  days: number,
  nowSeconds: number,
): Array<{ day: string; totalTokens: number; totalRequests: number }> {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const todayStart = Math.floor(nowSeconds / 86_400) * 86_400;
  const series: Array<{ day: string; totalTokens: number; totalRequests: number }> = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = utcDay(todayStart - offset * 86_400);
    const row = byDay.get(day);
    series.push({ day, totalTokens: row?.totalTokens ?? 0, totalRequests: row?.totalRequests ?? 0 });
  }
  return series;
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
    failedRequests: number;
    avgLatencyMs: number;
    byProvider: Array<{ providerId: string; totalTokens: number; totalRequests: number }>;
    daily: Array<{ day: string; totalTokens: number; totalRequests: number }>;
  }> {
    const dao = await this.deps.usageDAO();
    const clamped = Math.min(Math.max(days, 1), 90);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const since = now - clamped * 86_400;
    const [totals, byProvider, daily] = await Promise.all([
      dao.summarizeByUser(userEmail.toLowerCase(), since),
      dao.summarizeByProvider(userEmail.toLowerCase(), since),
      dao.summarizeDaily(userEmail.toLowerCase(), since),
    ]);
    return { ...totals, byProvider, daily: fillMissingDays(daily, clamped, now) };
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
