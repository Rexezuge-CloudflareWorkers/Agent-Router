#!/usr/bin/env tsx
/**
Record newly-added migration files in `migrations/migrations.lock.json`.

Provenance: Edge-Sonic's `scripts/migrations/verify-migrations.ts --write`,
which is the only repo that splits the two operations into two commands. The
other repos have one script with a flag; the split is kept here because the two
calls have different audiences and different blast radii — `verify-migrations`
runs in CI and changes nothing, while this one is an operator action that writes
a file into version control.

The rules live once, in `verify-migrations.ts`, so the two entrypoints cannot
disagree. `--write` is add-only: it records unlocked files, refreshes the
baseline's own entry, and drops entries the baseline absorbed. It never touches
another existing entry, so an incremental migration that has drifted still
fails afterwards — re-baselining one means deleting its entry by hand, which
shows up in the diff.

There is deliberately no `--force`, because a write that could bless a drift
without reading the drift is the operator blessing their own edit, and they are
by definition the one making it.

Usage, from the repo root:

```bash
pnpm exec tsx scripts/migrations-lock.ts                   # ./migrations
pnpm exec tsx scripts/migrations-lock.ts path/to/migrations
```
*/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCK_NAME, verifyMigrations } from './verify-migrations.ts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = process.argv[2] === undefined ? path.join(REPOSITORY_ROOT, 'migrations') : path.resolve(process.argv[2]);

const report = verifyMigrations(migrationsDir, { write: true });

for (const problem of report.problems) {
  console.error(`FAIL: ${problem.problem}`);
}

console.log(
  `${report.lock === null ? 'left' : 'wrote'} ${path.join(migrationsDir, LOCK_NAME)} (${report.files.length} migration(s) recorded)`,
);

// The lock is re-checked by the caller: `verify-migrations.ts` re-reads from disk,
// so running it after this command reports the same verdict CI will. A `--write`
// that could not resolve everything still exits non-zero here, which is why an
// incremental `edited` finding does not vanish just because someone wrote.
process.exit(report.problems.length === 0 ? 0 : 1);
