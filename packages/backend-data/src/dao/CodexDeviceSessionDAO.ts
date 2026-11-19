import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';

export interface CodexDeviceSessionRow {
  device_auth_id: string;
  provider_key_id: string;
  user_email: string;
  user_code: string;
  verification_url: string;
  poll_interval_seconds: number;
  created_at: number;
  expires_at: number;
  consumed_at: number | null;
}

export interface CodexDeviceSession {
  deviceAuthId: string;
  providerKeyId: string;
  userEmail: string;
  userCode: string;
  verificationUrl: string;
  pollIntervalSeconds: number;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

function toSession(row: CodexDeviceSessionRow): CodexDeviceSession {
  return {
    deviceAuthId: row.device_auth_id,
    providerKeyId: row.provider_key_id,
    userEmail: row.user_email,
    userCode: row.user_code,
    verificationUrl: row.verification_url,
    pollIntervalSeconds: row.poll_interval_seconds,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

class CodexDeviceSessionDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(row: {
    deviceAuthId: string;
    providerKeyId: string;
    userEmail: string;
    userCode: string;
    verificationUrl: string;
    pollIntervalSeconds: number;
    now: number;
    expiresAt: number;
  }): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO codex_device_sessions
              (device_auth_id, provider_key_id, user_email, user_code, verification_url, poll_interval_seconds, created_at, expires_at, consumed_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
          )
          .bind(
            row.deviceAuthId,
            row.providerKeyId,
            row.userEmail.toLowerCase(),
            row.userCode,
            row.verificationUrl,
            row.pollIntervalSeconds,
            row.now,
            row.expiresAt,
          )
          .run(),
      'create codex device session',
    );
  }

  public async getActiveByKey(providerKeyId: string, now: number): Promise<CodexDeviceSession | null> {
    const row = await this.database
      .prepare(
        `SELECT device_auth_id, provider_key_id, user_email, user_code, verification_url, poll_interval_seconds, created_at, expires_at, consumed_at
         FROM codex_device_sessions
         WHERE provider_key_id = ? AND expires_at > ? AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(providerKeyId, now)
      .first<CodexDeviceSessionRow>();
    return row ? toSession(row) : null;
  }

  public async consume(deviceAuthId: string, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare('UPDATE codex_device_sessions SET consumed_at = ? WHERE device_auth_id = ? AND consumed_at IS NULL')
          .bind(now, deviceAuthId)
          .run(),
      'consume codex device session',
    );
  }

  public async deleteByKey(providerKeyId: string): Promise<void> {
    await this.run(
      () => this.database.prepare('DELETE FROM codex_device_sessions WHERE provider_key_id = ?').bind(providerKeyId).run(),
      'delete codex device sessions by key',
    );
  }

  public async deleteExpiredOrConsumed(now: number, limit: number): Promise<number> {
    const result = await this.run(
      () =>
        this.database
          .prepare(
            `DELETE FROM codex_device_sessions
             WHERE device_auth_id IN (
               SELECT device_auth_id FROM codex_device_sessions
               WHERE expires_at < ? OR consumed_at IS NOT NULL
               LIMIT ?
             )`,
          )
          .bind(now, limit)
          .run(),
      'delete expired codex device sessions',
    );
    return result.meta?.changes ?? 0;
  }
}

export { CodexDeviceSessionDAO };
