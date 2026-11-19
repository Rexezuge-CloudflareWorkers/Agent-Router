import { isEntrypoint } from '../lib/entrypoint.ts';
/**
Verify the migration set is complete, ordered, and locked; write the lock.

Provenance: Edge-Sonic's `scripts/migrations/{verify-migrations,lock-check}.ts`
(the rule module plus its entrypoint) and AWS's `verify-migrations.ts`,
converged. Every copy checks the same properties of a `migrations/` directory;
they differ in lock-file naming, in whether the lock is enforced on CI, and in
how much of D1's ordering semantics they encode.

### Why a checksum lock at all

D1 records *which* migrations it has applied — the filename and a timestamp —
but not *what the file contained* when it applied them. So editing a migration
that has already run is not caught by anything: the deploy still succeeds, the
local database built from the baseline plus the edited file picks up the new
statements, and production keeps the schema it had. The two databases then
differ silently and permanently, and the next migration that assumes the newer
shape fails only in production. A committed digest per file turns that into a
CI failure.

### What the checks are, and where each comes from

- **`NNNN_snake_case.sql`** (AWS) — the numbering *is* the ordering: D1 sorts by
  filename, so a file that sorts *after* the ones already applied is the only
  kind that can be introduced safely.
- **Contiguous prefixes** (AWS) — a hole means one database applied 0001 and
  0003 while another applied only 0001, and nothing downstream can tell which.
  Checked **only when no squash baseline exists**: a squash legitimately
  absorbs its predecessors, so numbering restarts wherever it starts, and a
  contiguity rule that fires on a squash is a rule that blocks the squash.
- **One entry per file** (all) — a file with no recorded digest is one nothing
  can say anything about.
- **Digest unchanged** (all) — the edited-after-locking failure.
- **No orphan entries** (Edge-Sonic) — a locked file that is gone has been
  applied to a live database and is no longer reproducible from this repo.
- **Strictly increasing prefixes** (Edge-Sonic's `out-of-order`) — a file
  sorting *before* the newest locked one can never reach a database that has
  applied that newest one, so its statements would only run on a fresh build.
- **No duplicate prefixes** (Edge-Sonic) — two files numbered `0033_` are not a
  style problem: D1 orders them by the rest of the filename, so which one lands
  on a given database depends on a lexicographic tiebreak nobody intended.

### The squash baseline

`0008_squash.sql` holds the combined schema of every migration before it, and
those files are deleted when it is created. A later squash repeats that. So a
squash legitimately (a) rewrites one file and (b) removes files the lock still
lists, and neither may be reported as drift. The baseline is the
highest-numbered `NNNN_squash.sql` **on disk**, never the value the lock claims
— deriving it means a stale or forged `baseline` cannot widen the exempt set.

### The one write path

`--write` is add-only where it counts: it records unlocked files, refreshes the
baseline's own entry, and drops entries the baseline absorbed. Every other
entry is left exactly as it is, so an incremental `edited` finding **survives a
`--write`** — re-baselining one means deleting its entry by hand, which shows
up in the diff. There is deliberately no `--force`, because a write that could
bless a drift would be the operator blessing their own edit.
*/
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
One migration as the lock records it.
*/
interface MigrationEntry {
  name: string;
  sha256: string;
}

/**
The parsed `migrations/migrations.lock.json`.
*/
interface MigrationLockFile {
  version: 1;
  /**
  The squashed-baseline filename, when the repo has squashed.
  
  Everything at or before it is exempt from the `edited` and `orphan` checks,
  because that is exactly the set a squash rewrites or absorbs.
  */
  baseline?: string;
  migrations: MigrationEntry[];
}

/**
One failure, phrased for the operator.
*/
interface MigrationProblem {
  problem: string;
}

/**
The outcome of one run.
*/
interface MigrationReport {
  /**
  Migration filenames, in apply order.
  */
  files: string[];
  problems: MigrationProblem[];
  /**
  The lock as it reads after the run.
  */
  lock: MigrationLockFile | null;
}

/**
The lock's filename, beside the `.sql` files.

Named `migrations.lock.json` rather than `migrations.json` so it cannot be
mistaken for a migration: wrangler applies `*.sql` only, and a lock named like
one would be a deploy-time mystery.
*/
const LOCK_NAME = 'migrations.lock.json';

/**
The filename shape every migration must have. `NNNN_` is fixed at four digits.
*/
const NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
The squashed-baseline shape. The highest-numbered match is the baseline.
*/
const SQUASH_PATTERN = /^\d{4}_squash\.sql$/;

/**
The lock's format version. Bumped only on an incompatible shape change.
*/
const LOCK_VERSION = 1;

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
The highest-numbered `NNNN_squash.sql` on disk, or `undefined` when the repo
has not squashed — in which case every migration is incremental and therefore
every one of them is immutable.
*/
export function baselineOf(files: readonly string[]): string | undefined {
  let highest: string | undefined;
  for (const name of files) {
    if (SQUASH_PATTERN.test(name) && (highest === undefined || name > highest)) {
      highest = name;
    }
  }
  return highest;
}

/**
True when `name` is at or before the baseline, i.e. the set a squash absorbs.
*/
function isSubsumed(name: string, baseline: string | undefined): boolean {
  return baseline !== undefined && name <= baseline;
}

/**
Read the migration set and validate its shape without consulting the lock.

The lock is read here too, so one walk answers both "what is on disk" and "what
is recorded"; a lock that is merely *absent* is reported by `verifyMigrations`
rather than here, because that is the bootstrap case rather than a defect.
*/
function inspectMigrations(migrationsDir: string): MigrationReport {
  const problems: MigrationProblem[] = [];
  if (!existsSync(migrationsDir)) {
    problems.push({ problem: `${migrationsDir} does not exist` });
    return { files: [], problems, lock: null };
  }

  // Top level only, matching wrangler's default `${migrationsDir}/*.sql`, so the
  // lock describes exactly the set wrangler will run. `migrations.lock.json` is
  // not one of them, because it is not a `.sql` file.
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));

  for (const name of files) {
    if (!NAME_PATTERN.test(name)) {
      problems.push({ problem: `${name} does not match NNNN_snake_case.sql` });
    }
  }

  const baseline = baselineOf(files);
  const prefixes = files.map((name) => NAME_PATTERN.exec(name)?.[1]);

  // Strictly increasing: the property D1 actually depends on. A duplicate or a
  // descending prefix means two files compete for the same slot in the apply
  // order, and which one wins is a lexicographic tiebreak nobody intended.
  for (let index = 1; index < prefixes.length; index += 1) {
    const previous = prefixes[index - 1];
    const current = prefixes[index];
    if (previous !== undefined && current !== undefined && current <= previous) {
      problems.push({
        problem: `${files[index] ?? '?'} sorts at or before ${files[index - 1] ?? '?'} — D1 applies in filename order, so one of the two can never run`,
      });
    }
  }

  // Contiguity is checked only with no squash on disk: a squash deletes the files
  // it absorbs, so numbering restarts wherever it starts and a hole is the
  // expected shape rather than a defect.
  if (baseline === undefined) {
    for (const [index, prefix] of prefixes.entries()) {
      const expected = String(index + 1).padStart(4, '0');
      if (prefix !== expected) {
        problems.push({
          problem: `migration numbering is not contiguous: expected ${expected}_*.sql, found ${files[index] ?? '?'}`,
        });
      }
    }
  }

  const lockPath = path.join(migrationsDir, LOCK_NAME);
  let lock: MigrationLockFile | null = null;
  if (existsSync(lockPath)) {
    try {
      lock = JSON.parse(readFileSync(lockPath, 'utf8')) as MigrationLockFile;
    } catch {
      problems.push({ problem: `${LOCK_NAME} is not valid JSON` });
    }
  }

  return { files, problems, lock };
}

/**
The lock as `--write` would leave it.

`null` when the existing lock cannot be trusted as a base, which is exactly
when a `--write` must refuse rather than overwrite contents it failed to
understand. A lock that is merely *absent* is not malformed: that is the
bootstrap case, and it is built from disk like any other.
*/
function buildUpdatedLock(
  migrationsDir: string,
  files: readonly string[],
  existing: MigrationLockFile | null,
  baseline: string | undefined,
): MigrationLockFile | null {
  const digestOf = (name: string): string => sha256Hex(readFileSync(path.join(migrationsDir, name), 'utf8'));

  if (existing === null) {
    return {
      version: LOCK_VERSION,
      ...(baseline !== undefined && { baseline }),
      migrations: files.map((name) => ({ name, sha256: digestOf(name) })),
    };
  }

  const kept = new Map<string, string>();
  for (const file of files) {
    const recorded = existing.migrations.find((entry) => entry.name === file);
    if (recorded === undefined) continue;
    // The baseline is the one file a squash is allowed to rewrite.
    kept.set(file, file === baseline ? digestOf(file) : recorded.sha256);
  }
  // Unlocked files are added — that is the new-migration case. Every other entry
  // is carried across untouched, so an `edited` finding survives the write.
  for (const file of files) {
    if (!kept.has(file) && existing.migrations.every((entry) => entry.name !== file)) {
      kept.set(file, digestOf(file));
    }
  }
  // Entries the baseline absorbed are dropped: committing a squash looks exactly
  // like this, and neither it nor a rewritten baseline can hide a divergence,
  // because a database that applied those files already has them recorded in D1's
  // own `d1_migrations`.
  for (const entry of existing.migrations) {
    if (!files.includes(entry.name) && !isSubsumed(entry.name, baseline)) {
      kept.set(entry.name, entry.sha256);
    }
  }

  return {
    version: LOCK_VERSION,
    ...(baseline !== undefined && { baseline }),
    migrations: [...kept].sort(([left], [right]) => left.localeCompare(right)).map(([name, sha256]) => ({ name, sha256 })),
  };
}

/**
Verify (or with `write: true`, record) the lock against the files.
*/
function verifyMigrations(migrationsDir: string, options: { write?: boolean } = {}): MigrationReport {
  const report = inspectMigrations(migrationsDir);
  const baseline = baselineOf(report.files);

  // A malformed lock is a finding in its own right, and a `--write` must not
  // overwrite contents it failed to understand.
  if (report.problems.length > 0) {
    return report;
  }

  if (options.write === true) {
    const updated = buildUpdatedLock(migrationsDir, report.files, report.lock, baseline);
    const next = `${JSON.stringify(updated, null, 2)}\n`;
    const lockfile = path.join(migrationsDir, LOCK_NAME);
    let before: string | null = null;
    try {
      before = readFileSync(lockfile, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw error;
      }
    }
    if (before !== next) {
      writeFileSync(lockfile, next, 'utf8');
    }
    report.lock = updated;
    return report;
  }

  const lock = report.lock;
  if (lock === null) {
    report.problems.push({ problem: `${LOCK_NAME} is missing — run migrations:lock` });
    return report;
  }

  const recorded = new Map(lock.migrations.map((entry) => [entry.name, entry.sha256]));
  for (const name of report.files) {
    const expected = recorded.get(name);
    if (expected === undefined) {
      report.problems.push({ problem: `${name} has no lock entry — run migrations:lock` });
      continue;
    }
    // At or before the baseline, a squash rewrites its own file, and that is the
    // whole reason a baseline exists.
    if (isSubsumed(name, baseline)) continue;
    const actual = sha256Hex(readFileSync(path.join(migrationsDir, name), 'utf8'));
    if (actual !== expected) {
      report.problems.push({
        problem: `${name} changed after locking (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
      });
    }
  }

  for (const entry of lock.migrations) {
    if (report.files.includes(entry.name) || isSubsumed(entry.name, baseline)) continue;
    report.problems.push({ problem: `${entry.name} is in the lock but no longer exists` });
  }

  // A file sorting before the newest locked one can never reach a database that
  // has already applied that newest one, so its statements would only run on a
  // fresh build — the same silent split the checksum exists to prevent.
  const newest = [...recorded.keys()].sort((left, right) => left.localeCompare(right)).at(-1);
  if (newest !== undefined) {
    for (const name of report.files) {
      if (name < newest && !recorded.has(name)) {
        report.problems.push({
          problem: `${name} sorts before ${newest}, which is already locked — D1 applies in filename order, so it would never run on a database that has applied ${newest}`,
        });
      }
    }
  }

  return report;
}

/**
CLI entry: `verifyMigrationsCli(['[migrations-dir]?', '--write'?'])`.
*/
function verifyMigrationsCli(argv: readonly string[] = process.argv.slice(2)): number {
  const dir = argv.find((arg) => !arg.startsWith('--')) ?? 'migrations';
  const write = argv.includes('--write');
  const report = verifyMigrations(dir, { write });
  if (report.problems.length > 0) {
    console.error(`Migration validation failed for ${dir}:`);
    for (const problem of report.problems) console.error(`  - ${problem.problem}`);
    return 1;
  }
  if (write) {
    console.log(`Migration lock written (${report.files.length} files).`);
    return 0;
  }
  console.log(`Migration validation passed (${report.files.length} files, lock in sync).`);
  return 0;
}

export { inspectMigrations, verifyMigrations, verifyMigrationsCli, LOCK_NAME, LOCK_VERSION };
export type { MigrationEntry, MigrationLockFile, MigrationProblem, MigrationReport };

// Run only when this file is the entrypoint.
//
// The rules above are pure and the tests import them directly, so a module-level
// call would shell out (and exit) during a test run. The URL comparison rather than
// an unconditional call is the same guard Durable-DAV's init-secrets.ts uses, and
// it is what keeps the rule modules importable — which is the whole reason they are
// separate modules in the first place.
if (isEntrypoint(import.meta.url)) {
  process.exit(verifyMigrationsCli(process.argv.slice(2)));
}
