import { BaseDAO } from './BaseDAO';

export interface UserPeakPreferenceRow {
  user_email: string;
  mode: string;
  fallback_model: string | null;
  updated_at: number;
}

class UserPeakPreferenceDAO extends BaseDAO {
  public async getByEmail(email: string): Promise<UserPeakPreferenceRow | null> {
    return this.database
      .prepare('SELECT * FROM user_peak_preferences WHERE lower(user_email) = lower(?) LIMIT 1')
      .bind(email)
      .first<UserPeakPreferenceRow>();
  }

  public async upsert(email: string, mode: string, fallbackModel: string | null, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO user_peak_preferences (user_email, mode, fallback_model, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(user_email) DO UPDATE SET
               mode = excluded.mode,
               fallback_model = excluded.fallback_model,
               updated_at = excluded.updated_at`,
          )
          .bind(email, mode, fallbackModel, now)
          .run(),
      'upsert user peak preference',
    );
  }
}

export { UserPeakPreferenceDAO };
