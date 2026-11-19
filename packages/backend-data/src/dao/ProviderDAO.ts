import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';
import type { ProviderKind, ProviderMetadata, ProviderStatus } from '@agent-router/shared';

export interface ProviderRow {
  id: string;
  user_email: string;
  kind: string;
  name: string;
  base_url: string | null;
  status: string;
  created_at: number;
  updated_at: number | null;
}

function toMetadata(row: ProviderRow): ProviderMetadata {
  return {
    id: row.id,
    userEmail: row.user_email,
    kind: row.kind as ProviderKind,
    name: row.name,
    baseUrl: row.base_url,
    status: row.status as ProviderStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ProviderDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(row: {
    id: string;
    userEmail: string;
    kind: ProviderKind;
    name: string;
    baseUrl: string | null;
    now: number;
  }): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            'INSERT INTO providers (id, user_email, kind, name, base_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)',
          )
          .bind(row.id, row.userEmail.toLowerCase(), row.kind, row.name, row.baseUrl, 'active', row.now)
          .run(),
      'create provider',
    );
  }

  public async getById(id: string): Promise<ProviderMetadata | null> {
    const row = await this.database.prepare('SELECT * FROM providers WHERE id = ? LIMIT 1').bind(id).first<ProviderRow>();
    return row ? toMetadata(row) : null;
  }

  public async listByUser(userEmail: string): Promise<ProviderMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM providers WHERE lower(user_email) = lower(?) ORDER BY created_at ASC')
      .bind(userEmail)
      .all<ProviderRow>();
    return (result.results ?? []).map(toMetadata);
  }

  public async update(
    id: string,
    userEmail: string,
    patch: { name?: string; baseUrl?: string | null; status?: ProviderStatus; now: number },
  ): Promise<boolean> {
    const current = await this.getById(id);
    if (!current || current.userEmail.toLowerCase() !== userEmail.toLowerCase()) return false;
    await this.run(
      () =>
        this.database
          .prepare('UPDATE providers SET name = ?, base_url = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(patch.name ?? current.name, patch.baseUrl ?? current.baseUrl, patch.status ?? current.status, patch.now, id)
          .run(),
      'update provider',
    );
    return true;
  }

  public async delete(id: string, userEmail: string): Promise<void> {
    await this.run(
      () => this.database.prepare('DELETE FROM providers WHERE id = ? AND lower(user_email) = lower(?)').bind(id, userEmail).run(),
      'delete provider',
    );
  }

  public async countByUser(userEmail: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM providers WHERE lower(user_email) = lower(?)')
      .bind(userEmail)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }
}

export { ProviderDAO };
