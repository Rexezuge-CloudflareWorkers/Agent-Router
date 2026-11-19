import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';

export interface UserRow {
  email: string;
  created_at: number;
  username: string | null;
  updated_at: number | null;
}

class UserDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async upsertUser(email: string, now: number): Promise<void> {
    await this.run(
      () =>
        this.database.prepare('INSERT INTO users (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING').bind(email, now).run(),
      'upsert user',
    );
  }

  public async ensureUsername(email: string, username: string, now: number): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare('UPDATE users SET username = COALESCE(username, ?), updated_at = COALESCE(updated_at, ?) WHERE email = ?')
          .bind(username, now, email)
          .run(),
      'ensure username',
    );
  }

  public async setUsername(email: string, username: string, now: number): Promise<void> {
    await this.run(
      () => this.database.prepare('UPDATE users SET username = ?, updated_at = ? WHERE email = ?').bind(username, now, email).run(),
      'set username',
    );
  }

  public async getByEmail(email: string): Promise<UserRow | null> {
    return this.database.prepare('SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1').bind(email).first<UserRow>();
  }

  public async getByUsernameCi(usernameCi: string): Promise<UserRow | null> {
    return this.database.prepare('SELECT * FROM users WHERE lower(username) = ? LIMIT 1').bind(usernameCi).first<UserRow>();
  }
}

export { UserDAO };
