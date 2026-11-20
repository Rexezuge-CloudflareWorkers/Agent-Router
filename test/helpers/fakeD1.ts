import type { D1Queryable, D1Result } from '@rexezuge/d1';

/**
Scriptable D1 stand-in for DAO unit tests.

Records every statement (query + bindings) so an assertion can check the SQL
shape and parameter order, and resolves `first`/`all`/`run` from a handler the
test supplies. This exercises the DAO's real SQL without a workers runtime.
*/

interface RecordedStatement {
  query: string;
  bindings: unknown[];
  kind: 'first' | 'all' | 'run';
}

interface FakeD1 {
  database: D1Queryable;
  statements: RecordedStatement[];
}

type Responder = (statement: RecordedStatement) => unknown;

/**
Builds a fake D1. `respond` is called for each statement; return the row for
`first`, the rows array for `all`, or meta for `run` as appropriate.
*/
function createFakeD1(respond: Responder = () => 0): FakeD1 {
  const statements: RecordedStatement[] = [];
  const prepared = (query: string, bindings: unknown[]): Record<string, unknown> => ({
    bind: (...next: unknown[]) => prepared(query, next),
    first: async <T>() => {
      const statement: RecordedStatement = { query, bindings, kind: 'first' };
      statements.push(statement);
      return (respond(statement) as T | null) ?? null;
    },
    all: async <T>() => {
      const statement: RecordedStatement = { query, bindings, kind: 'all' };
      statements.push(statement);
      const results = respond(statement);
      return { results: (results as T[]) ?? [] };
    },
    run: async (): Promise<D1Result> => {
      const statement: RecordedStatement = { query, bindings, kind: 'run' };
      statements.push(statement);
      const meta = respond(statement);
      return { success: true, meta: (meta as D1Result['meta']) ?? { changes: 1 } };
    },
  });
  const database: D1Queryable = { prepare: (query: string) => prepared(query, []) as never };
  return { database, statements };
}

export { createFakeD1 };
export type { FakeD1, RecordedStatement, Responder };
