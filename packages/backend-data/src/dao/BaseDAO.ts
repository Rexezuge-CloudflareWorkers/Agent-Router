import type { D1Queryable, D1Result } from '@rexezuge/d1';
import { executeWithRetry } from '@rexezuge/d1';
import { CursorUtil } from '../utils/CursorUtil';

const SQL_IDENTIFIER_PATTERN = /^[a-z_]\w*$/i;

function assertSqlIdentifier(value: string, label: string): void {
  if (!SQL_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid SQL identifier for ${label}: ${value}`);
  }
}

/**
Agent-Router's business DAO base.

The retry engine, error classifier and structural D1 types come from
`@rexezuge/d1`; this class keeps the closure-first helpers the business DAOs
were written against. The kit's `BaseDAO` is sql-first, and rewriting every
DAO onto it is a behavioural change that belongs in its own refactor.
*/
abstract class BaseDAO {
  constructor(protected readonly database: D1Queryable) {}

  protected run(operation: () => Promise<D1Result>, context: string): Promise<D1Result> {
    return executeWithRetry(operation, context);
  }

  // Instance variants of the static helpers below, bound to this DAO's
  // database so subclasses stop threading `db` through every call.
  protected findRowById<T>(table: string, idColumn: string, idValue: string, columns = '*'): Promise<T | null> {
    return BaseDAO.findById<T>(this.database, table, idColumn, idValue, columns);
  }

  protected deleteRowsOlderThan(
    table: string,
    timeColumn: string,
    cutoff: number | string,
    limit: number,
    idColumn: string,
  ): Promise<number> {
    return BaseDAO.deleteOlderThan(this.database, table, timeColumn, cutoff, limit, idColumn);
  }

  // Shared opaque-cursor codec. Per-DAO `encodeCursor/parseCursor` wrappers
  // should delegate here and only add payload validation.
  protected encodeCursor(value: unknown): string {
    return CursorUtil.encode(value);
  }

  protected decodeCursor<T>(cursor: string | undefined): T | undefined {
    return CursorUtil.decode<T>(cursor);
  }

  // Generic row lookup by primary key. Table/column identifiers are allow-listed
  // to keep dynamic SQL safe; values always go through bindings.
  protected static async findById<T>(db: D1Queryable, table: string, idColumn: string, idValue: string, columns = '*'): Promise<T | null> {
    assertSqlIdentifier(table, 'table');
    assertSqlIdentifier(idColumn, 'idColumn');
    let selectColumns = '*';
    if (columns !== '*') {
      const validated: string[] = columns.split(',').map((column: string): string => {
        const trimmed: string = column.trim();
        assertSqlIdentifier(trimmed, 'column');
        return trimmed;
      });
      selectColumns = validated.join(', ');
    }
    const row: T | null = await db.prepare(`SELECT ${selectColumns} FROM ${table} WHERE ${idColumn} = ? LIMIT 1`).bind(idValue).first<T>();
    return row ?? null;
  }

  // Generic batched delete of rows older than a cutoff. Mirrors the per-DAO
  // DELETE ... WHERE id IN (SELECT ... LIMIT ?) pattern with retry.
  protected static async deleteOlderThan(
    db: D1Queryable,
    table: string,
    timeColumn: string,
    cutoff: number | string,
    limit: number,
    idColumn: string,
  ): Promise<number> {
    assertSqlIdentifier(table, 'table');
    assertSqlIdentifier(timeColumn, 'timeColumn');
    assertSqlIdentifier(idColumn, 'idColumn');
    const result: D1Result = await executeWithRetry(
      (): Promise<D1Result> =>
        db
          .prepare(
            `DELETE FROM ${table}
             WHERE ${idColumn} IN (
               SELECT ${idColumn} FROM ${table}
               WHERE ${timeColumn} < ?
               LIMIT ?
             )`,
          )
          .bind(cutoff, limit)
          .run(),
      `delete old rows from ${table}`,
    );
    return (result.meta as { changes?: number })?.changes ?? 0;
  }
}

export { BaseDAO };
