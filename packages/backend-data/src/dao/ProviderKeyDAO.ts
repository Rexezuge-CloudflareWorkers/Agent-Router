import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';
import type { CodexOAuthStatus, ProviderKeyMetadata, ProviderKeyStatus } from '@agent-router/shared';
import { toMetadata } from './providerKeyTypes';
import type { ProviderKeyRow } from './providerKeyTypes';

class ProviderKeyDAO extends BaseDAO {
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
    tokenLimit: number | null;
    requestLimit: number | null;
    resetAt: number | null;
    priority: number;
    now: number;
  }): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO provider_keys (id, provider_id, user_email, name, encrypted_key, key_hint,
              token_limit, request_limit, used_tokens, used_requests, reset_at, priority, status,
              cooldown_until, consecutive_failures, last_used_at, last_error, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'active', NULL, 0, NULL, NULL, ?, NULL)`,
          )
          .bind(
            row.id,
            row.providerId,
            row.userEmail.toLowerCase(),
            row.name,
            row.encryptedKey,
            row.keyHint,
            row.tokenLimit,
            row.requestLimit,
            row.resetAt,
            row.priority,
            row.now,
          )
          .run(),
      'create provider key',
    );
  }

  public async getById(id: string): Promise<ProviderKeyRow | null> {
    return this.database.prepare('SELECT * FROM provider_keys WHERE id = ? LIMIT 1').bind(id).first<ProviderKeyRow>();
  }

  public async getMetadataById(id: string): Promise<ProviderKeyMetadata | null> {
    const row = await this.getById(id);
    return row ? toMetadata(row) : null;
  }

  public async listByProvider(providerId: string): Promise<ProviderKeyMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM provider_keys WHERE provider_id = ? ORDER BY priority ASC, created_at ASC')
      .bind(providerId)
      .all<ProviderKeyRow>();
    return (result.results ?? []).map(toMetadata);
  }

  public async listSelectableByProvider(providerId: string, now: number): Promise<ProviderKeyRow[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM provider_keys WHERE provider_id = ?
         AND status IN ('active', 'degraded') AND (cooldown_until IS NULL OR cooldown_until <= ?)
         ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                  priority ASC, last_used_at ASC NULLS FIRST, created_at ASC`,
      )
      .bind(providerId, now)
      .all<ProviderKeyRow>();
    return result.results ?? [];
  }

  public async countByProvider(providerId: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM provider_keys WHERE provider_id = ?')
      .bind(providerId)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  public async updateMeta(
    id: string,
    patch: {
      name?: string;
      priority?: number;
      tokenLimit?: number | null;
      requestLimit?: number | null;
      status?: ProviderKeyStatus;
      now: number;
    },
  ): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;
    await this.run(
      () =>
        this.database
          .prepare(
            'UPDATE provider_keys SET name = ?, priority = ?, token_limit = ?, request_limit = ?, status = ?, updated_at = ? WHERE id = ?',
          )
          .bind(
            patch.name ?? current.name,
            patch.priority ?? current.priority,
            patch.tokenLimit ?? current.token_limit,
            patch.requestLimit ?? current.request_limit,
            patch.status ?? current.status,
            patch.now,
            id,
          )
          .run(),
      'update provider key',
    );
  }

  public async recordSuccess(id: string, promptTokens: number, completionTokens: number, now: number): Promise<void> {
    const total = promptTokens + completionTokens;
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET used_tokens = used_tokens + ?, used_requests = used_requests + 1,
             consecutive_failures = 0, cooldown_until = NULL,
             status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'active' END,
             last_used_at = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(total, now, now, id)
          .run(),
      'record key success',
    );
  }

  public async recordFailure(id: string, error: string, cooldownUntil: number | null, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET consecutive_failures = consecutive_failures + 1,
             cooldown_until = ?, last_error = ?, last_used_at = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(cooldownUntil, error.slice(0, 500), now, now, id)
          .run(),
      'record key failure',
    );
  }

  public async markDegraded(id: string, error: string, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET status = CASE WHEN status = 'disabled' THEN 'disabled' ELSE 'degraded' END,
             cooldown_until = NULL, consecutive_failures = 0, last_error = ?, last_used_at = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(error.slice(0, 500), now, now, id)
          .run(),
      'mark key degraded',
    );
  }

  public async markExhausted(id: string, now: number): Promise<void> {
    await this.run(
      () => this.database.prepare(`UPDATE provider_keys SET status = 'exhausted', updated_at = ? WHERE id = ?`).bind(now, id).run(),
      'mark key exhausted',
    );
  }

  public async resetUsage(id: string, resetAt: number | null, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET used_tokens = 0, used_requests = 0, reset_at = ?, status = 'active', cooldown_until = NULL, consecutive_failures = 0, updated_at = ? WHERE id = ?`,
          )
          .bind(resetAt, now, id)
          .run(),
      'reset key usage',
    );
  }

  public async resetDueKeys(now: number, limit: number): Promise<number> {
    const result = await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET used_tokens = 0, used_requests = 0, status = 'active', cooldown_until = NULL, consecutive_failures = 0, updated_at = ?
             WHERE id IN (SELECT id FROM provider_keys WHERE reset_at IS NOT NULL AND reset_at <= ? LIMIT ?)`,
          )
          .bind(now, now, limit)
          .run(),
      'reset due keys',
    );
    return result.meta?.changes ?? 0;
  }

  /**
  Disables a single key that has crossed the consecutive-failure threshold.

  Kept as a DAO method (rather than raw SQL in the router) so callers stay
  behind the retry engine and the statement is testable in isolation.
  */
  public async disable(id: string, now: number): Promise<void> {
    await this.run(
      () => this.database.prepare(`UPDATE provider_keys SET status = 'disabled', updated_at = ? WHERE id = ?`).bind(now, id).run(),
      'disable provider key',
    );
  }

  /**
  Replaces a static key's secret and clears its failure state in one write.

  Used by rotate; `status` preserves an explicitly disabled key, matching the
  previous behaviour.
  */
  public async rotateSecret(
    id: string,
    patch: { encryptedKey: string; keyHint: string | null; status: ProviderKeyStatus; now: number },
  ): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET encrypted_key = ?, key_hint = ?, consecutive_failures = 0, cooldown_until = NULL,
             status = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(patch.encryptedKey, patch.keyHint, patch.status, patch.now, id)
          .run(),
      'rotate provider key',
    );
  }

  public async disableFailing(threshold: number, now: number, limit: number): Promise<number> {
    const result = await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET status = 'disabled', updated_at = ?
             WHERE id IN (SELECT id FROM provider_keys WHERE status != 'disabled' AND consecutive_failures >= ? LIMIT ?)`,
          )
          .bind(now, threshold, limit)
          .run(),
      'disable failing keys',
    );
    return result.meta?.changes ?? 0;
  }

  public async delete(id: string): Promise<void> {
    await this.run(() => this.database.prepare('DELETE FROM provider_keys WHERE id = ?').bind(id).run(), 'delete provider key');
  }

  public async createOAuthKey(row: {
    id: string;
    providerId: string;
    userEmail: string;
    name: string;
    priority: number;
    now: number;
  }): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO provider_keys (id, provider_id, user_email, name, encrypted_key, key_hint,
              token_limit, request_limit, used_tokens, used_requests, reset_at, priority, status,
              cooldown_until, consecutive_failures, last_used_at, last_error, created_at, updated_at,
              auth_type, encrypted_access_token, encrypted_refresh_token, codex_account_id, access_expires_at, oauth_status)
             VALUES (?, ?, ?, ?, '', NULL, NULL, NULL, 0, 0, NULL, ?, 'active', NULL, 0, NULL, NULL, ?, NULL,
              'codex_oauth', NULL, NULL, NULL, NULL, 'pending')`,
          )
          .bind(row.id, row.providerId, row.userEmail.toLowerCase(), row.name, row.priority, row.now)
          .run(),
      'create codex oauth key',
    );
  }

  public async updateOAuthConnected(
    id: string,
    patch: {
      encryptedAccessToken: string | null;
      encryptedRefreshToken: string;
      accountId: string | null;
      accessExpiresAt: number;
      now: number;
    },
  ): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET encrypted_access_token = ?, encrypted_refresh_token = ?, codex_account_id = ?, access_expires_at = ?,
              oauth_status = 'connected', consecutive_failures = 0, cooldown_until = NULL, last_error = NULL, updated_at = ?
              WHERE id = ? AND auth_type = 'codex_oauth'`,
          )
          .bind(patch.encryptedAccessToken, patch.encryptedRefreshToken, patch.accountId, patch.accessExpiresAt, patch.now, id)
          .run(),
      'update codex oauth connected',
    );
  }

  public async updateOAuthRefreshed(
    id: string,
    patch: { encryptedAccessToken: string | null; encryptedRefreshToken: string; accessExpiresAt: number; now: number },
  ): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET encrypted_access_token = ?, encrypted_refresh_token = ?, access_expires_at = ?,
              oauth_status = 'connected', consecutive_failures = 0, cooldown_until = NULL, last_error = NULL, updated_at = ?
              WHERE id = ? AND auth_type = 'codex_oauth'`,
          )
          .bind(patch.encryptedAccessToken, patch.encryptedRefreshToken, patch.accessExpiresAt, patch.now, id)
          .run(),
      'update codex oauth refreshed',
    );
  }

  public async updateOAuthRefreshedConditional(
    id: string,
    expectedEncryptedRefreshToken: string,
    patch: { encryptedAccessToken: string | null; encryptedRefreshToken: string; accessExpiresAt: number; now: number },
  ): Promise<boolean> {
    const result = await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET encrypted_access_token = ?, encrypted_refresh_token = ?, access_expires_at = ?,
              oauth_status = 'connected', consecutive_failures = 0, cooldown_until = NULL, last_error = NULL, updated_at = ?
              WHERE id = ? AND auth_type = 'codex_oauth' AND encrypted_refresh_token = ?`,
          )
          .bind(
            patch.encryptedAccessToken,
            patch.encryptedRefreshToken,
            patch.accessExpiresAt,
            patch.now,
            id,
            expectedEncryptedRefreshToken,
          )
          .run(),
      'update codex oauth refreshed conditional',
    );
    return (result.meta?.changes ?? 0) > 0;
  }

  public async setOAuthStatus(id: string, status: CodexOAuthStatus, error: string | null, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(`UPDATE provider_keys SET oauth_status = ?, last_error = ?, updated_at = ? WHERE id = ? AND auth_type = 'codex_oauth'`)
          .bind(status, error, now, id)
          .run(),
      'set codex oauth status',
    );
  }

  public async clearOAuth(id: string, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `UPDATE provider_keys SET encrypted_access_token = NULL, encrypted_refresh_token = NULL, codex_account_id = NULL, access_expires_at = NULL,
              oauth_status = 'pending', consecutive_failures = 0, cooldown_until = NULL, last_error = NULL, updated_at = ?
              WHERE id = ? AND auth_type = 'codex_oauth'`,
          )
          .bind(now, id)
          .run(),
      'clear codex oauth',
    );
  }

  /**
  Rows whose OAuth access token is due for refresh.

  Selection is driven purely by `access_expires_at <= threshold`; the caller's
  wall clock is baked into `threshold`, so no separate `now` is needed here.
  */
  public async listOAuthRefreshCandidates(threshold: number, limit: number): Promise<ProviderKeyRow[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM provider_keys WHERE auth_type = 'codex_oauth' AND oauth_status = 'connected'
          AND encrypted_refresh_token IS NOT NULL AND (access_expires_at IS NULL OR access_expires_at <= ?)
          ORDER BY access_expires_at ASC NULLS FIRST LIMIT ?`,
      )
      .bind(threshold, limit)
      .all<ProviderKeyRow>();
    return result.results ?? [];
  }
}

export { ProviderKeyDAO };

export { type ProviderKeyRow } from './providerKeyTypes';
