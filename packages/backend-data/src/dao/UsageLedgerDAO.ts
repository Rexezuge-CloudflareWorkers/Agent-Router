import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';
import type { UsageLedgerMetadata } from '@agent-router/shared';

export interface UsageLedgerRow {
  id: string;
  user_email: string;
  gateway_key_id: string | null;
  provider_id: string | null;
  provider_key_id: string | null;
  upstream_model: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number | null;
  status_code: number;
  error_code: string | null;
  estimated: number;
  created_at: number;
}

function toMetadata(row: UsageLedgerRow): UsageLedgerMetadata {
  return {
    id: row.id,
    userEmail: row.user_email,
    gatewayKeyId: row.gateway_key_id,
    providerId: row.provider_id,
    providerKeyId: row.provider_key_id,
    upstreamModel: row.upstream_model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    latencyMs: row.latency_ms,
    statusCode: row.status_code,
    errorCode: row.error_code,
    estimated: row.estimated === 1,
    createdAt: row.created_at,
  };
}

class UsageLedgerDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async insert(row: {
    id: string;
    userEmail: string;
    gatewayKeyId: string | null;
    providerId: string | null;
    providerKeyId: string | null;
    upstreamModel: string | null;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number | null;
    statusCode: number;
    errorCode: string | null;
    estimated: boolean;
    now: number;
  }): Promise<void> {
    const total = row.promptTokens + row.completionTokens;
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO usage_ledger (id, user_email, gateway_key_id, provider_id, provider_key_id,
              upstream_model, prompt_tokens, completion_tokens, total_tokens, latency_ms,
              status_code, error_code, estimated, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            row.id,
            row.userEmail.toLowerCase(),
            row.gatewayKeyId,
            row.providerId,
            row.providerKeyId,
            row.upstreamModel,
            row.promptTokens,
            row.completionTokens,
            total,
            row.latencyMs,
            row.statusCode,
            row.errorCode,
            row.estimated ? 1 : 0,
            row.now,
          )
          .run(),
      'insert usage',
    );
  }

  public async listByUser(
    userEmail: string,
    limit: number,
    cursor?: string,
  ): Promise<{ rows: UsageLedgerMetadata[]; nextCursor: string | null }> {
    const since = this.decodeCursor<{ createdAt: string; id: string }>(cursor);
    let rows: UsageLedgerRow[];
    if (since) {
      const result = await this.database
        .prepare(
          `SELECT * FROM usage_ledger WHERE lower(user_email) = lower(?)
           AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC LIMIT ?`,
        )
        .bind(userEmail, Number(since.createdAt), Number(since.createdAt), since.id, limit + 1)
        .all<UsageLedgerRow>();
      rows = result.results ?? [];
    } else {
      const rowsResult = await this.database
        .prepare(`SELECT * FROM usage_ledger WHERE lower(user_email) = lower(?) ORDER BY created_at DESC, id DESC LIMIT ?`)
        .bind(userEmail, limit + 1)
        .all<UsageLedgerRow>();
      rows = rowsResult.results ?? [];
    }
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? this.encodeCursor({ createdAt: String(last.created_at), id: last.id }) : null;
    return { rows: page.map(toMetadata), nextCursor };
  }

  public async summarizeByUser(
    userEmail: string,
    since: number,
  ): Promise<{
    totalTokens: number;
    totalRequests: number;
    promptTokens: number;
    completionTokens: number;
    failedRequests: number;
    avgLatencyMs: number;
  }> {
    const row = await this.database
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status_code < 400 THEN total_tokens ELSE 0 END),0) AS totalTokens,
                COALESCE(SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END),0) AS totalRequests,
                COALESCE(SUM(CASE WHEN status_code < 400 THEN prompt_tokens ELSE 0 END),0) AS promptTokens,
                COALESCE(SUM(CASE WHEN status_code < 400 THEN completion_tokens ELSE 0 END),0) AS completionTokens,
                COALESCE(SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END),0) AS failedRequests,
                COALESCE(AVG(latency_ms),0) AS avgLatencyMs
         FROM usage_ledger WHERE lower(user_email) = lower(?) AND created_at >= ?`,
      )
      .bind(userEmail, since)
      .first<{
        totalTokens: number;
        totalRequests: number;
        promptTokens: number;
        completionTokens: number;
        failedRequests: number;
        avgLatencyMs: number;
      }>();
    return {
      totalTokens: row?.totalTokens ?? 0,
      totalRequests: row?.totalRequests ?? 0,
      promptTokens: row?.promptTokens ?? 0,
      completionTokens: row?.completionTokens ?? 0,
      failedRequests: row?.failedRequests ?? 0,
      avgLatencyMs: Math.round(row?.avgLatencyMs ?? 0),
    };
  }

  public async summarizeDaily(
    userEmail: string,
    since: number,
  ): Promise<Array<{ day: string; totalTokens: number; totalRequests: number }>> {
    const result = await this.database
      .prepare(
        `SELECT date(created_at, 'unixepoch') AS day,
                COALESCE(SUM(total_tokens),0) AS totalTokens,
                COUNT(*) AS totalRequests
         FROM usage_ledger
         WHERE lower(user_email) = lower(?) AND created_at >= ? AND status_code < 400
         GROUP BY day ORDER BY day ASC`,
      )
      .bind(userEmail, since)
      .all<{ day: string; totalTokens: number; totalRequests: number }>();
    return result.results ?? [];
  }

  public async summarizeByProvider(
    userEmail: string,
    since: number,
  ): Promise<Array<{ providerId: string; totalTokens: number; totalRequests: number }>> {
    const result = await this.database
      .prepare(
        `SELECT provider_id AS providerId, COALESCE(SUM(total_tokens),0) AS totalTokens, COUNT(*) AS totalRequests
         FROM usage_ledger WHERE lower(user_email) = lower(?) AND created_at >= ? AND status_code < 400
         GROUP BY provider_id ORDER BY totalTokens DESC LIMIT 50`,
      )
      .bind(userEmail, since)
      .all<{ providerId: string | null; totalTokens: number; totalRequests: number }>();
    return (result.results ?? []).filter(
      (r): r is { providerId: string; totalTokens: number; totalRequests: number } => typeof r.providerId === 'string',
    );
  }

  public async pruneOlderThan(cutoff: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('usage_ledger', 'created_at', cutoff, limit, 'id');
  }
}

export { UsageLedgerDAO };
