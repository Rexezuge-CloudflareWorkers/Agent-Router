import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';
import type { SearchProviderKeyStatus } from '@agent-router/shared';
import { toMetadata } from './searchProviderKeyTypes';
import type { SearchProviderKeyRow, SearchSelectableKeyRow } from './searchProviderKeyTypes';

/**
Key pool for third-party search providers. The write paths mirror
ProviderKeyDAO (success clears failures, 429 degrades, caps exhaust, cron
resets and disables) but this table has no token or OAuth columns.
*/
class SearchProviderKeyDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(row: {
    id: string;
    providerId: string;
    userEmail: string;
    name: string;
    encryptedKey: string;
    keyHint: string | null;
    requestLimit: number | null;
    resetAt: number | null;
    priority: number;
    now: number;
  }): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO search_provider_keys
              (id, provider_id, user_email, name, encrypted_key, key_hint,
               request_limit, used_requests, reset_at, priority, status,
               cooldown_until, consecutive_failures, last_used_at, last_error, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'active', NULL, 0, NULL, NULL, ?, NULL)`,
          )
          .bind(
            row.id,
            row.providerId,
            row.userEmail.toLowerCase(),
            row.name,
            row.encryptedKey,
            row.keyHint,
            row.requestLimit,
            row.resetAt,
            row.priority,
            row.now,
          )
          .run(),
      'create search provider key',
    );
  }

  public async getById(id: string): Promise<SearchProviderKeyRow | null> {
    return this.database.prepare('SELECT * FROM search_provider_keys WHERE id = ? LIMIT 1').bind(id).first<SearchProviderKeyRow>() ?? null;
  }

  public async getMetadataById(id: string) {
    const row = await this.getById(id);
    return row ? toMetadata(row) : null;
  }

  public async listByProvider(providerId: string) {
    const result = await this.database
      .prepare('SELECT * FROM search_provider_keys WHERE provider_id = ? ORDER BY priority ASC, created_at ASC')
      .bind(providerId)
      .all<SearchProviderKeyRow>();
    return (result.results ?? []).map(toMetadata);
  }

  public async listSelectableByProvider(providerId: string, now: number): Promise<SearchProviderKeyRow[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM search_provider_keys WHERE provider_id = ?
          AND status IN ('active', 'degraded') AND (cooldown_until IS NULL OR cooldown_until <= ?)
          ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                   priority ASC, last_used_at ASC NULLS FIRST, created_at ASC`,
      )
      .bind(providerId, now)
      .all<SearchProviderKeyRow>();
    return result.results ?? [];
  }

  /**
  Cross-provider failover pool: the preferred provider is tried first, then
  every other active search provider. `provider_kind` travels with the row
  so the caller can pick the right upstream request/response shape.
  */
  public async listSelectableByUser(userEmail: string, preferredProviderId: string | null, now: number): Promise<SearchSelectableKeyRow[]> {
    const result = await this.database
      .prepare(
        `SELECT k.*, p.kind AS provider_kind
          FROM search_provider_keys k
          JOIN search_providers p ON p.id = k.provider_id
          WHERE lower(k.user_email) = lower(?)
            AND p.status = 'active'
            AND k.status IN ('active', 'degraded')
            AND (k.cooldown_until IS NULL OR k.cooldown_until <= ?)
          ORDER BY CASE WHEN k.provider_id = ? THEN 0 ELSE 1 END,
                   CASE k.status WHEN 'active' THEN 0 ELSE 1 END,
                   k.priority ASC, k.last_used_at ASC NULLS FIRST, k.created_at ASC`,
      )
      .bind(userEmail, now, preferredProviderId ?? '')
      .all<SearchSelectableKeyRow>();
    return result.results ?? [];
  }

  public async countByProvider(providerId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM search_provider_keys WHERE provider_id = ?')
      .bind(providerId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  public async updateMeta(
    id: string,
    patch: { name?: string; priority?: number; requestLimit?: number | null; status?: SearchProviderKeyStatus; now: number },
  ): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;
    await this.run(
      () =>
        this.database
          .prepare('UPDATE search_provider_keys SET name = ?, priority = ?, request_limit = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(
            patch.name ?? current.name,
            patch.priority ?? current.priority,
            patch.requestLimit ?? current.request_limit,
            patch.status ?? current.status,
            patch.now,
            id,
          )
          .run(),
      'update search provider key',
    );
  }

  public async recordSuccess(id: string, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE search_provider_keys SET used_requests = used_requests + 1,
              consecutive_failures = 0, cooldown_until = NULL,
              status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'active' END,
              last_used_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(now, now, id)
          .run(),
      'record search key success',
    );
  }

  public async recordFailure(id: string, error: string, cooldownUntil: number | null, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE search_provider_keys SET consecutive_failures = consecutive_failures + 1,
              cooldown_until = ?, last_error = ?, last_used_at = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(cooldownUntil, error.slice(0, 500), now, now, id)
          .run(),
      'record search key failure',
    );
  }

  public async markDegraded(id: string, error: string, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE search_provider_keys SET status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'degraded' END,
              cooldown_until = NULL, consecutive_failures = 0, last_error = ?, last_used_at = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(error.slice(0, 500), now, now, id)
          .run(),
      'mark search key degraded',
    );
  }

  public async markExhausted(id: string, now: number): Promise<void> {
    await this.run(
      () => this.database.prepare(`UPDATE search_provider_keys SET status = 'exhausted', updated_at = ? WHERE id = ?`).bind(now, id).run(),
      'mark search key exhausted',
    );
  }

  public async resetUsage(id: string, resetAt: number | null, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE search_provider_keys SET used_requests = 0, reset_at = ?, status = 'active',
              cooldown_until = NULL, consecutive_failures = 0, updated_at = ? WHERE id = ?`,
          )
          .bind(resetAt, now, id)
          .run(),
      'reset search key usage',
    );
  }

  public async resetDueKeys(now: number, limit: number): Promise<number> {
    const result = await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE search_provider_keys SET used_requests = 0, status = 'active', cooldown_until = NULL,
              consecutive_failures = 0, updated_at = ?
              WHERE id IN (SELECT id FROM search_provider_keys WHERE reset_at IS NOT NULL AND reset_at <= ? LIMIT ?)`,
          )
          .bind(now, now, limit)
          .run(),
      'reset due search keys',
    );
    return result.meta?.changes ?? 0;
  }

  public async disable(id: string, now: number): Promise<void> {
    await this.run(
      () => this.database.prepare(`UPDATE search_provider_keys SET status = 'disabled', updated_at = ? WHERE id = ?`).bind(now, id).run(),
      'disable search provider key',
    );
  }

  public async disableFailing(threshold: number, now: number, limit: number): Promise<number> {
    const result = await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE search_provider_keys SET status = 'disabled', updated_at = ?
              WHERE id IN (SELECT id FROM search_provider_keys WHERE status != 'disabled' AND consecutive_failures >= ? LIMIT ?)`,
          )
          .bind(now, threshold, limit)
          .run(),
      'disable failing search keys',
    );
    return result.meta?.changes ?? 0;
  }

  public async rotateSecret(
    id: string,
    patch: { encryptedKey: string; keyHint: string | null; status: SearchProviderKeyStatus; now: number },
  ): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE search_provider_keys SET encrypted_key = ?, key_hint = ?, status = ?,
              cooldown_until = NULL, consecutive_failures = 0, last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(patch.encryptedKey, patch.keyHint, patch.status, patch.now, id)
          .run(),
      'rotate search key',
    );
  }

  public async delete(id: string): Promise<void> {
    await this.run(
      () => this.database.prepare('DELETE FROM search_provider_keys WHERE id = ?').bind(id).run(),
      'delete search provider key',
    );
  }
}

export { SearchProviderKeyDAO };
