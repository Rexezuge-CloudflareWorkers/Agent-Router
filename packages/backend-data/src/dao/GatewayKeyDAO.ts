import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';
import type { GatewayKeyMetadata } from '@agent-router/shared';

export interface GatewayKeyRow {
  key_id: string;
  user_email: string;
  key_hash: string;
  key_prefix: string;
  name: string;
  status: string;
  expires_at: number;
  last_used_at: number | null;
  created_at: number;
}

function toMetadata(row: GatewayKeyRow): GatewayKeyMetadata {
  return {
    keyId: row.key_id,
    userEmail: row.user_email,
    keyPrefix: row.key_prefix,
    name: row.name,
    status: row.status as GatewayKeyMetadata['status'],
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

class GatewayKeyDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(row: {
    keyId: string;
    userEmail: string;
    keyHash: string;
    keyPrefix: string;
    name: string;
    expiresAt: number;
    now: number;
  }): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            'INSERT INTO gateway_keys (key_id, user_email, key_hash, key_prefix, name, status, expires_at, last_used_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)',
          )
          .bind(row.keyId, row.userEmail.toLowerCase(), row.keyHash, row.keyPrefix, row.name, 'active', row.expiresAt, row.now)
          .run(),
      'create gateway key',
    );
  }

  public async getByHash(keyHash: string, now: number): Promise<GatewayKeyRow | null> {
    return this.database
      .prepare(`SELECT * FROM gateway_keys WHERE key_hash = ? AND status = 'active' AND expires_at > ? LIMIT 1`)
      .bind(keyHash, now)
      .first<GatewayKeyRow>();
  }

  public async listByUser(userEmail: string): Promise<GatewayKeyMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM gateway_keys WHERE lower(user_email) = lower(?) ORDER BY created_at DESC')
      .bind(userEmail)
      .all<GatewayKeyRow>();
    return (result.results ?? []).map(toMetadata);
  }

  public async countActiveByUser(userEmail: string): Promise<number> {
    const row = await this.database
      .prepare(`SELECT COUNT(*) AS count FROM gateway_keys WHERE lower(user_email) = lower(?) AND status = 'active'`)
      .bind(userEmail)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  public async touchLastUsed(keyHash: string, now: number): Promise<void> {
    await this.run(
      () => this.database.prepare('UPDATE gateway_keys SET last_used_at = ? WHERE key_hash = ?').bind(now, keyHash).run(),
      'touch gateway key',
    );
  }

  public async revoke(keyId: string, userEmail: string): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(`UPDATE gateway_keys SET status = 'revoked' WHERE key_id = ? AND lower(user_email) = lower(?)`)
          .bind(keyId, userEmail)
          .run(),
      'revoke gateway key',
    );
  }

  public async pruneExpired(now: number, limit: number): Promise<number> {
    return this.deleteRowsOlderThan('gateway_keys', 'expires_at', now, limit, 'key_id');
  }
}

export { GatewayKeyDAO };
