import { BaseDAO } from './BaseDAO';

export interface GatewayKeyPeakPreferenceRow {
  key_id: string;
  mode: string;
  fallback_model: string | null;
  updated_at: number;
}

class GatewayKeyPeakPreferenceDAO extends BaseDAO {
  public async getByKeyId(keyId: string): Promise<GatewayKeyPeakPreferenceRow | null> {
    return this.database
      .prepare('SELECT * FROM gateway_key_peak_preferences WHERE key_id = ? LIMIT 1')
      .bind(keyId)
      .first<GatewayKeyPeakPreferenceRow>();
  }

  public async upsert(keyId: string, mode: string, fallbackModel: string | null, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO gateway_key_peak_preferences (key_id, mode, fallback_model, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(key_id) DO UPDATE SET
               mode = excluded.mode,
               fallback_model = excluded.fallback_model,
               updated_at = excluded.updated_at`,
          )
          .bind(keyId, mode, fallbackModel, now)
          .run(),
      'upsert gateway key peak preference',
    );
  }
}

export { GatewayKeyPeakPreferenceDAO };
