import { BaseDAO } from './BaseDAO';
import type { D1Queryable } from '@rexezuge/d1';
import type { SearchProviderKind, SearchProviderMetadata, SearchProviderStatus } from '@agent-router/shared';

export interface SearchProviderRow {
  id: string;
  user_email: string;
  kind: string;
  name: string;
  status: string;
  created_at: number;
  updated_at: number | null;
}

function toMetadata(row: SearchProviderRow): SearchProviderMetadata {
  return {
    id: row.id,
    userEmail: row.user_email,
    kind: row.kind as SearchProviderKind,
    name: row.name,
    status: row.status as SearchProviderStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class SearchProviderDAO extends BaseDAO {
  constructor(database: D1Queryable) {
    super(database);
  }

  public async create(row: { id: string; userEmail: string; kind: SearchProviderKind; name: string; now: number }): Promise<void> {
    await this.run(
      () =>
        this.database
          .prepare(
            'INSERT INTO search_providers (id, user_email, kind, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
          )
          .bind(row.id, row.userEmail.toLowerCase(), row.kind, row.name, 'active', row.now)
          .run(),
      'create search provider',
    );
  }

  public async getById(id: string): Promise<SearchProviderMetadata | null> {
    const row = await this.database.prepare('SELECT * FROM search_providers WHERE id = ? LIMIT 1').bind(id).first<SearchProviderRow>();
    return row ? toMetadata(row) : null;
  }

  public async listByUser(userEmail: string): Promise<SearchProviderMetadata[]> {
    const result = await this.database
      .prepare('SELECT * FROM search_providers WHERE lower(user_email) = lower(?) ORDER BY created_at ASC')
      .bind(userEmail)
      .all<SearchProviderRow>();
    return (result.results ?? []).map(toMetadata);
  }

  public async update(
    id: string,
    userEmail: string,
    patch: { name?: string; status?: SearchProviderStatus; now: number },
  ): Promise<boolean> {
    const current = await this.getById(id);
    if (!current || current.userEmail.toLowerCase() !== userEmail.toLowerCase()) return false;
    await this.run(
      () =>
        this.database
          .prepare('UPDATE search_providers SET name = ?, status = ?, updated_at = ? WHERE id = ?')
          .bind(patch.name ?? current.name, patch.status ?? current.status, patch.now, id)
          .run(),
      'update search provider',
    );
    return true;
  }

  public async delete(id: string, userEmail: string): Promise<void> {
    await this.run(
      () => this.database.prepare('DELETE FROM search_providers WHERE id = ? AND lower(user_email) = lower(?)').bind(id, userEmail).run(),
      'delete search provider',
    );
  }

  public async countByUser(userEmail: string): Promise<number> {
    const row = await this.database
      .prepare('SELECT COUNT(*) AS count FROM search_providers WHERE lower(user_email) = lower(?)')
      .bind(userEmail)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }
}

export { SearchProviderDAO };
