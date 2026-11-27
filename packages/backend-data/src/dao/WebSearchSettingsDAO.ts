import { BaseDAO } from './BaseDAO';

export interface WebSearchSettingsRow {
  user_email: string;
  mode: string;
  provider: string | null;
  encrypted_api_key: string | null;
  key_hint: string | null;
  created_at: number;
  updated_at: number;
}

class WebSearchSettingsDAO extends BaseDAO {
  public async getByEmail(userEmail: string): Promise<WebSearchSettingsRow | null> {
    return this.database
      .prepare('SELECT * FROM user_web_search_settings WHERE user_email = ? LIMIT 1')
      .bind(userEmail.toLowerCase())
      .first<WebSearchSettingsRow>();
  }

  public async upsert(
    userEmail: string,
    mode: string,
    provider: string | null,
    encryptedApiKey: string | null,
    keyHint: string | null,
    now: number,
  ): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            `INSERT INTO user_web_search_settings
              (user_email, mode, provider, encrypted_api_key, key_hint, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(user_email) DO UPDATE SET
               mode = excluded.mode,
               provider = excluded.provider,
               encrypted_api_key = excluded.encrypted_api_key,
               key_hint = excluded.key_hint,
               updated_at = excluded.updated_at`,
          )
          .bind(userEmail.toLowerCase(), mode, provider, encryptedApiKey, keyHint, now, now)
          .run(),
      'upsert web search settings',
    );
  }
}

export { WebSearchSettingsDAO };
