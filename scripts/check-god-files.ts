/**
The rules behind `scripts/check-god-files.ts`.

Provenance: converged from the seven `.mjs` copies (AWS-AccessBridge,
CalDAV-Bridge, ChordDHT-Tracker, Durable-DAV, Durable-DAV-Router, Edge-Git,
Mail-Meow, Mail-Otter) and the typed ratchet in Edge-Sonic.

All seven `.mjs` copies are one script with two constants: soft 300 (warn),
hard 400 (error). The typed variant is not a different rule so much as a
different answer to "what does the gate enforce", and that is the decision this
module has to take once for the whole family.

### The convergence: warn-only, with an allowlist

The two source designs:

- **Ceiling** (six repos) — 300 warn, 400 error, `exit 1` on 400. Durable-DAV's
  own `AGENTS.md` records what that measures: **ten** files sit just over 300
  and none is a god file, so `WARN` reports every run and `HARD` has never
  fired. A ceiling set above the largest file in the tree cannot tell a
  repository getting worse from one that never got better, and raising it is
  always available.
- **Ratchet** (Edge-Sonic) — a committed baseline records every file's size; a
  file may shrink freely and grow only to its recorded size. It cannot be
  satisfied by raising a number, which is its whole strength.

The ratchet is the better *rule*, and the ceiling is the better *gate*: the
ratchet needs a baseline maintained per file and fails the first time somebody
writes a legitimate 320-line module, which is the failure mode that trains
everyone to ignore a report. So the converged script keeps the 300/400
thresholds — every repo's CI already prints them — and makes the verdict
**warn-only by default**, with two escape valves that are both visible in a
diff:

1. `--fail-on-hard` turns the 400 line back into a failing gate, for a repo
  that has paid its debt and wants the ceiling enforced.
2. An **allowlist** records the files that are over the line and known, so the
  report names only the ones that are *new*. That is the ratchet's
  "recorded size" idea without its per-file bookkeeping: the allowlist is
  reviewed by the same commit that grows the file, because the diff shows what
  was added to it.

Tests are excluded, as every source does. A double modelling the platform grows
with the platform's surface, not with the complexity of the code it stands in
for — Edge-Sonic's ratchet holds them too, and its own notes record a 4,343-line
fixture, so this is a documented disagreement rather than an oversight.
*/

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fail } from './lib/github-actions.ts';
import { isEntrypoint } from './lib/entrypoint.ts';
import { isSet, parseFlags, splitPositional, valueOf } from './lib/cli-args.ts';

/**
A file past a size the guard reports on.
*/
export interface GodFileFinding {
  /**
  Path relative to the root the check ran against.
  */
  readonly file: string;
  /**
  Lines it has.
  */
  readonly lines: number;
  /**
  `warn` past the soft limit, `critical` past the hard one.
  */
  readonly level: 'warn' | 'critical';
}

/**
The outcome of one run.
*/
export interface GodFileReport {
  /**
  Files over a limit, worst first, minus the allowlisted.
  */
  readonly findings: readonly GodFileFinding[];
  /**
  How many files the walk measured.
  */
  readonly scanned: number;
  /**
  Allowlisted files that are over a limit — reported, never counted.
  */
  readonly allowlisted: readonly GodFileFinding[];
  /**
  Whether the tree may be committed as it stands.
  
  `true` in warn-only mode, which is the default; a `critical` finding fails
  only when the caller asked for the gate.
  */
  readonly passed: boolean;
  /**
  The message to print, either way.
  */
  readonly reported: string;
}

/**
What `checkGodFiles` accepts.
*/
export interface GodFileOptions {
  /**
  Directory to walk.
  */
  readonly root: string;
  /**
  Repo-relative paths (or directory prefixes ending in `/`) exempt from the
  report. Defaults to `god-files.allowlist.json` beside the caller's script
  when that file exists — see `readAllowlist`.
  */
  readonly allowlist?: readonly string[];
  /**
  Soft limit, past which a file is reported as `warn`.
  */
  readonly soft?: number;
  /**
  Hard limit, past which a file is reported as `critical`.
  */
  readonly hard?: number;
  /**
  Make a `critical` finding fail the run.
  */
  readonly failOnHard?: boolean;
}

/**
Default soft limit, as every source repo uses.
*/
export const SOFT_LIMIT = 300;
/**
Default hard limit, as every source repo uses.
*/
export const HARD_LIMIT = 400;

/**
Directories the walker never enters.

Build output and VCS state; `coverage` is here because a generated HTML report
is thousands of "lines" of nothing.
*/
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.wrangler', 'coverage', 'coverage-integration', 'coverage-web', '.git']);

/**
Source extensions the guard counts.

`css` is in the set because every source repo counts it, and a 400-line
stylesheet is the same reading problem as a 400-line module.
*/
const SOURCE_EXTENSIONS = /\.(?:ts|tsx|js|mjs|cjs|css)$/;

/**
The test-file suffixes the guard skips.

`.test.tsx` matter as much as `.test.ts`: the walker collects both, so a list
that only named the `.ts` forms let every React test file through the guard and
reported them as god files — which is how Durable-DAV-Router discovered it.
Built from the kinds and extensions rather than enumerated, so a new test
extension cannot silently escape.
*/
const TEST_SUFFIXES: readonly string[] = ['test', 'spec'].flatMap((kind) =>
  ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].map((ext) => `.${kind}${ext}`),
);

/**
Whether a repo-relative path is exempt from the guard.

Provenance: AWS-AccessBridge's version is the canonical one, because it
documents and fixes two live bugs in the others.

Every directory pattern is anchored with `(?:^|/)` rather than a bare leading
`/`. `relative()` yields `test/helpers/x.ts` for a top-level test directory and
`scripts/lib/x.ts` for the scripts directory — **no leading separator** — so a
pattern written as `/\/(?:test|tests|__tests__)\//` never matches either one.
It looks right, it does match when handed an absolute path, and against these
layouts it is silently a no-op. Durable-DAV and ChordDHT-Tracker ship exactly
that dead pattern.
*/
export function shouldSkip(rel: string): boolean {
  if (
    /(?:^|\/)(?:locales|generated)\//.test(rel) ||
    /(?:^|\/)__(?:tests|mocks)__(?:\/|$)/.test(rel) ||
    /(?:^|\/)scripts\//.test(rel) ||
    /(?:^|\/)(?:test|tests|__tests__)\//.test(rel) ||
    /\.config\.(?:m?[jt]s|cjs)$/.test(rel) ||
    rel.endsWith('.d.ts') ||
    rel.endsWith('.json') ||
    rel.endsWith('.sql') ||
    rel.endsWith('.md')
  )
    return true;
  return TEST_SUFFIXES.some((suffix) => rel.endsWith(suffix));
}

/**
Whether a repo-relative path is on the allowlist.

An entry ending in `/` exempts a whole directory; any other entry is matched
exactly, so `apps/api/src/index.ts` does not exempt `apps/api/src/index.util.ts`.
*/
export function isAllowlisted(rel: string, allowlist: readonly string[]): boolean {
  return allowlist.some((entry) => (entry.endsWith('/') ? rel.startsWith(entry) : rel === entry));
}

/**
Every source file under `root`, as repo-relative paths.

Symlink-safe: a dangling symlink or a file removed mid-walk is skipped rather
than thrown, because neither is a god-file problem.
*/
export function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (EXCLUDE_DIRS.has(entry)) continue;
        visit(full);
      } else if (SOURCE_EXTENSIONS.test(entry)) {
        out.push(path.relative(root, full));
      }
    }
  };
  visit(root);
  return out;
}

/**
Run the guard over a tree.

Pure with respect to the verdict — the only I/O is the walk and a line count —
so a test drives it against a temporary directory.
*/
export function checkGodFiles(options: GodFileOptions): GodFileReport {
  const soft = options.soft ?? SOFT_LIMIT;
  const hard = options.hard ?? HARD_LIMIT;
  const allowlist = options.allowlist ?? [];

  const scanned = walk(options.root).filter((rel) => !shouldSkip(rel));
  const findings: GodFileFinding[] = [];
  const allowlisted: GodFileFinding[] = [];

  for (const rel of scanned) {
    const lines = readFileSync(path.join(options.root, rel), 'utf8').split('\n').length;
    if (lines <= soft) continue;
    const finding: GodFileFinding = { file: rel, lines, level: lines > hard ? 'critical' : 'warn' };
    if (isAllowlisted(rel, allowlist)) {
      allowlisted.push(finding);
    } else {
      findings.push(finding);
    }
  }

  findings.sort((left, right) => right.lines - left.lines);
  allowlisted.sort((left, right) => right.lines - left.lines);

  const critical = findings.filter((finding) => finding.level === 'critical');
  const passed = options.failOnHard !== true || critical.length === 0;

  const reported = passed
    ? `God-file check passed (${scanned.length} files, ${findings.length} over soft limit ${soft}, ${allowlisted.length} allowlisted).`
    : `God-file check failed: ${critical.length} file(s) exceed ${hard} LOC. Split them, or add them to the allowlist in the same commit that grows them.`;

  return { findings, allowlisted, scanned: scanned.length, passed, reported };
}

/**
Read an allowlist file, or `[]` when it is absent.

The file is `scripts/god-files.allowlist.json`: a JSON array of repo-relative
paths. Absence is the normal case for a repo with no known offenders, so it is
not an error — a guard that fails on a first run nobody has filled in yet is a
guard that gets disabled.

A malformed file is an error rather than an empty list, because "the allowlist
is empty" silently un-reports every known offender.
*/
export function readAllowlist(file: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${file} must be a JSON array of repo-relative path strings.`);
  }
  return parsed as string[];
}

/**
CLI entry: `checkGodFilesCli(['.', '--fail-on-hard'])`.

The directory is a positional argument **or** `--root <dir>`, because every other
script in this tree takes its target positionally and a gate that has to be
invoked one way in one script and another way in the next is a gate somebody
invokes wrong. A second positional is an error.

Flags (see FlagSpec): `--root <dir>` (default `.`), `--allowlist <file>`
(default `scripts/god-files.allowlist.json` beside the root, absent = none),
`--fail-on-hard` (default off, matching every source repo's warn-only gate).
Returns 0 unless `--fail-on-hard` is set and a critical file is found.
*/
export function checkGodFilesCli(argv: readonly string[] = process.argv.slice(2)): number {
  // Split before parsing, because parseFlags rejects anything that is not a declared
  // flag and a positional directory is neither a mistake nor a flag.
  const { positional, rest } = splitPositional(argv, ['root', 'allowlist']);
  const flags = parseFlags(rest, {
    value: ['root', 'allowlist'],
    boolean: ['fail-on-hard'],
  });
  const root = valueOf(flags, 'root') ?? positional[0] ?? '.';
  const allowlistPath = valueOf(flags, 'allowlist') ?? path.join(root, 'scripts/god-files.allowlist.json');
  const report = checkGodFiles({
    root,
    allowlist: readAllowlist(allowlistPath),
    failOnHard: isSet(flags, 'fail-on-hard'),
  });
  console.log(report.reported);
  for (const finding of report.findings) {
    console.log(`${finding.level === 'critical' ? 'CRITICAL' : 'WARN'} ${finding.lines} ${finding.file}`);
  }
  for (const finding of report.allowlisted) {
    console.log(`ALLOWLISTED ${finding.lines} ${finding.file}`);
  }
  if (!report.passed) {
    fail(`God-file check failed: run with --root ${root} to see the report.`);
  }
  return 0;
}

// Run only when this file is the entrypoint.
//
// The rules above are pure and the tests import them directly, so a module-level
// call would shell out (and exit) during a test run. The URL comparison rather than
// an unconditional call is the same guard Durable-DAV's init-secrets.ts uses, and
// it is what keeps the rule modules importable — which is the whole reason they are
// separate modules in the first place.
if (isEntrypoint(import.meta.url)) {
  process.exit(checkGodFilesCli(process.argv.slice(2)));
}
