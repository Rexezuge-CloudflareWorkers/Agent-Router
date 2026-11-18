import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '../utils/D1Types';

export interface CommandCodeKeyStateRow {
  provider_key_id: string;
  next_init_at: number;
  fingerprint_recorded_at: number | null;
  lifecycle_sent_at: number | null;
  created_at: number;
  updated_at: number | null;
}

class CommandCodeKeyStateDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async get(providerKeyId: string): Promise<CommandCodeKeyStateRow | null> {
    return this.findRowById<CommandCodeKeyStateRow>('command_code_key_state', 'provider_key_id', providerKeyId);
  }

  public async markInitialized(providerKeyId: string, nextInitAt: number, now: number): Promise<void> {
    await this.withRetry(
      () =>
        this.database
          .prepare(
            `INSERT INTO command_code_key_state
               (provider_key_id, next_init_at, fingerprint_recorded_at, lifecycle_sent_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(provider_key_id) DO UPDATE SET
               next_init_at = excluded.next_init_at,
               fingerprint_recorded_at = excluded.fingerprint_recorded_at,
               lifecycle_sent_at = excluded.lifecycle_sent_at,
               updated_at = excluded.updated_at`,
          )
          .bind(providerKeyId, nextInitAt, now, now, now, now)
          .run(),
      'mark command code key initialized',
    );
  }
}

export { CommandCodeKeyStateDAO };
