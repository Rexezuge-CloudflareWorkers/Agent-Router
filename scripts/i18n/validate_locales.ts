import { isEntrypoint } from '../lib/entrypoint.ts';
/**
Validate that every locale bundle carries exactly the base locale's keys.

Provenance: `scripts/validate_locales.{mjs,ts}` in Durable-DAV, Edge-Git and
Mail-Meow, and Edge-Sonic's `scripts/i18n/locale-checks.ts` +
`validate_locales.ts`, converged. All four copies agree on the contract:
flattened dotted key paths, two-way parity (missing AND extra), no empty values,
no stray placeholders.

### What the convergence added

Edge-Sonic's is the only copy that checks what a value *is*. The rest compare
bundle to bundle, so with one shipped language the whole per-tag body is skipped
and the script reports `ALL OK` having checked nothing about the application — it
could not see that `libraries.scanPausedRequests` was used and absent, because
the string in the bundle did not exist to be wrong *about* anything. Hence
`--call-sites`: every `t('key')` under `apps/web/src` must resolve.

Key **order** drift against the base is a warning, not a failure: locale files
are maintained by mirroring new keys into every file, and failing on order would
turn an otherwise-correct translation update into a CI failure about formatting.

### Three on-disk shapes, one checker

The family ships bundles in three shapes, and the shape is an argument rather
than a fork of the script:

- `auto` (default) — every layout below, tried in order, so a repo that has
  half-migrated is reported rather than silently skipped;
- `dir` — `<locales-dir>/<tag>/translation.json`, the i18next layout used by
  seven repos;
- `file` — `<locales-dir>/<tag>.json`, one flat file per tag;
- `module` — `<locales-dir>/<tag>.ts` exporting an object literal, which is the
  shape `@rexezuge/i18n` uses for the backend string bundles. The literal is
  extracted and normalised here, so the same gate covers the backend catalogs
  the kit ships and the SPA bundles the repos do.
*/
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
The bundle layouts the checker understands.
*/
type LocaleShape = 'auto' | 'dir' | 'file' | 'module';

/**
One defect, kept as a locale plus a message so a caller can group them.
*/
interface LocaleProblem {
  locale: string;
  problem: string;
  /**
  Reported, but not a failure.
  
  The distinction is **"this build is wrong"** against **"this merge is still
  in flight"**, and a gate that cannot tell them apart gets switched off. A
  key the bundles carry that no call site reaches is the ordinary state of a
  bundle running ahead of its UI, and a translator adding a string for a screen
  that has not been wired is doing the right thing. It is also the only thing
  that catches a call site deleted or renamed without its key — which keeps a
  translator re-translating a string no user will ever see.
  
  So it is reported and it does not fail the run.
  
  The finding that is **not** advisory is the mirror: a `t()` key the bundle
  lacks. That one renders the inline default for every user in every language,
  it is actionable in the same commit, and there is no in-flight state in which
  it is the right answer — so it stays fatal, and the report below prints the
  two classes separately rather than counting them together.
  */
  advisory?: boolean;
}

/**
The outcome of one run.
*/
interface LocaleReport {
  locales: string[];
  keys: number;
  problems: LocaleProblem[];
}

/**
Every dotted key path in a bundle, depth first.
*/
function flatten(value: unknown, prefix = '', out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) out.set(prefix, value);
    return out;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    if (prefix) out.set(prefix, value);
    return out;
  }
  for (const [key, child] of entries) {
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

/**
The interpolation tokens in a value, sorted.

Sorted so two values carrying the same tokens in different orders compare equal —
substitution is by name, so order carries no meaning. `localeCompare` rather than
the default comparator so a reported mismatch does not change with the machine's
locale.
*/
function placeholdersOf(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.match(/\{\{[^{}]+\}\}/g))].sort((left: string, right: string) => left.localeCompare(right));
}

/**
A source file to check `t()` call sites under, and how far down to look.
*/
interface CallSiteScope {
  /**
  Directory walked for source files.
  */
  dir: string;
  /**
  Extensions treated as source.
  */
  extensions: readonly string[];
}

/**
Read a bundle as a value, in whichever shape it is written.

`module` is the shape `@rexezuge/i18n` ships: `const enStrings: BackendStrings =
{ common: { unauthorized: '…' } };`. Extracting the literal rather than importing
the module is the point — a validator that imported the bundle would typecheck it
against the kit's own types, and therefore agree with whatever it was given.
*/
function readBundle(file: string): unknown {
  const source = readFileSync(file, 'utf8');
  // Decided by the file's extension, not by the caller's `shape`: under `auto` a
  // `.ts` bundle is found, and reading it as JSON would report a parse error for a
  // file that is perfectly well-formed.
  return file.endsWith('.ts') ? parseObjectLiteral(source, file) : (JSON.parse(source) as unknown);
}

/**
The first balanced object literal in a TypeScript module, as a value.

Brace-matched outside strings and comments, and started at the **first
assignment** rather than at the first brace — see `objectLiteralStart` for why the
difference is the whole rule. Single-quoted strings are normalised to
double-quoted JSON, bare keys are quoted, and trailing commas are tolerated: that
is all the shape this needs, and a translator file that needs more is not a
translator file.
*/
/**
Where the object literal begins: the first brace **after the first assignment**.

The assignment matters. `const enStrings: BackendStrings = { ... }` is preceded by
an import line whose own braces open earlier in the file, so a plain
`indexOf('{')` returns the import's pair and the "literal" extracted is
`{ BackendStrings }` — an empty object that parses cleanly and then reports the
base bundle as having no keys. Finding the assignment first skips every brace that
is not the value being bound to it.
*/
function objectLiteralStart(source: string): number {
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    const next = source[index + 1];
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== '') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '-' && next === '-') {
      inLineComment = true;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    // The assignment, and not a comparison or an arrow: `=>` and `==` both contain an
    // `=`, and neither is where a bundle's object literal is attached.
    const previous = source[index - 1];
    if (char === '=' && next !== '=' && next !== '>' && previous !== '=' && previous !== '!' && previous !== '<' && previous !== '>') {
      const brace = source.indexOf('{', index);
      return brace === -1 ? -1 : brace;
    }
  }
  return -1;
}

function parseObjectLiteral(source: string, file: string): unknown {
  const start = objectLiteralStart(source);
  if (start === -1) {
    throw new Error(`${file} has no object literal`);
  }

  let depth = 0;
  let end = -1;
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    const next = source[index + 1];
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== '') {
      // An escape consumes the next character, so `\'` does not close the string.
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '-' && next === '-') {
      inLineComment = true;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1) {
    throw new Error(`${file} has an unterminated object literal`);
  }

  const literal = source.slice(start, end + 1);
  // Three normalisations, each of which a JSON parser needs and a TS literal does not:
  // single-quoted strings become double-quoted (applied only to string literals, so a
  // value containing an apostrophe keeps it), bare keys get quoted, and trailing
  // commas are dropped. A translator file that needs more than that is not a
  // translator file.
  const doubleQuoted = literal.replaceAll(/'((?:[^'\\]|\\.)*)'/g, (_match, body: string) => JSON.stringify(unescapeLiteral(body)));
  const quotedKeys = doubleQuoted.replaceAll(/([{,]\s*)([A-Z_$][\w$]*)(\s*:)/gi, '$1"$2"$3');
  const withoutTrailingCommas = quotedKeys.replaceAll(/,(\s*[}\]])/g, '$1');

  try {
    return JSON.parse(withoutTrailingCommas) as unknown;
  } catch (error: unknown) {
    throw new Error(`${file} object literal could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
The escapes a translator file actually uses; anything else is passed through.
*/
function unescapeLiteral(body: string): string {
  return body
    .replaceAll(String.raw`\'`, "'")
    .replaceAll(String.raw`\"`, '"')
    .replaceAll(String.raw`\n`, '\n')
    .replaceAll(String.raw`\t`, '\t')
    .replaceAll(String.raw`\\`, '\\');
}

/**
The extensions a flat layout uses, keyed by shape.
*/
const FLAT_EXTENSION: Record<'file' | 'module', string> = { file: 'json', module: 'ts' };

/**
The layouts `shape` covers. `auto` covers all three, in the order they are tried.
*/
function layouts(shape: LocaleShape): Array<'dir' | 'file' | 'module'> {
  return shape === 'auto' ? ['dir', 'file', 'module'] : [shape];
}

/**
The tags on disk, in whichever layouts `shape` covers.
*/
function tagsOnDisk(localesDir: string, shape: LocaleShape): string[] {
  const tags: string[] = [];
  if (layouts(shape).includes('dir')) {
    tags.push(
      ...readdirSync(localesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
    );
  }
  for (const layout of layouts(shape)) {
    if (layout === 'dir') continue;
    const extension = FLAT_EXTENSION[layout];
    tags.push(
      ...readdirSync(localesDir)
        .filter((name) => name.endsWith(`.${extension}`))
        .map((name) => name.slice(0, -extension.length - 1)),
    );
  }
  return tags;
}

/**
The file a tag's bundle lives in, or `undefined` when it is not there.

Every candidate is tried rather than only the one `shape` names, because a repo
with a half-migrated tree is a repo whose missing half should be reported. A
checker that only looked where it was told would read a bundle that exists as
absent, and a missing bundle is the defect this script exists to find.
*/
function bundleFor(localesDir: string, locale: string, shape: LocaleShape): string | undefined {
  const candidates: string[] = [];
  if (layouts(shape).includes('dir')) {
    candidates.push(path.join(localesDir, locale, 'translation.json'));
  }
  for (const layout of layouts(shape)) {
    if (layout === 'dir') continue;
    candidates.push(path.join(localesDir, `${locale}.${FLAT_EXTENSION[layout]}`));
  }
  return candidates.find((candidate) => existsSync(candidate));
}

/**
The base bundle, flattened, for a scope that checks the application against it.

@throws when the bundle cannot be found or parsed — the caller reports that as a
  problem rather than reporting "all clear" against an empty key set, which is
  the one outcome a locale gate must never produce silently.
*/
function bundleAt(localesDir: string, baseLocale: string, shape: LocaleShape): Map<string, unknown> {
  const file = bundleFor(localesDir, baseLocale, shape);
  if (file === undefined) {
    throw new Error(`no bundle found for the base locale (expected ${baseLocale}/translation.json)`);
  }
  return flatten(readBundle(file));
}

/**
Validate a directory of locale bundles against `baseLocale`'s key set.

Two-way parity: a key the base has and a bundle lacks renders the fallback, and
a key a bundle has that the base lacks is dead weight nothing can translate from.
*/
function validateLocales(localesDir: string, baseLocale = 'en', shape: LocaleShape = 'auto'): LocaleReport {
  const problems: LocaleProblem[] = [];
  if (!existsSync(localesDir)) {
    problems.push({ locale: baseLocale, problem: `${localesDir} does not exist` });
    return { locales: [], keys: 0, problems };
  }

  const baseFile = bundleFor(localesDir, baseLocale, shape);
  if (baseFile === undefined) {
    problems.push({ locale: baseLocale, problem: `no bundle found for the base locale (expected ${baseLocale}/translation.json)` });
    return { locales: [], keys: 0, problems };
  }

  let baseBundle: Map<string, unknown>;
  try {
    baseBundle = flatten(readBundle(baseFile));
  } catch (error: unknown) {
    problems.push({ locale: baseLocale, problem: `${baseFile}: ${error instanceof Error ? error.message : String(error)}` });
    return { locales: [], keys: 0, problems };
  }
  const baseKeys = new Set(baseBundle.keys());

  if (baseKeys.size === 0) {
    // An empty base is the one defect that reaches the most users: it is the fallback
    // for every missing key, so an empty value here is indistinguishable from a
    // missing bundle at runtime.
    problems.push({ locale: baseLocale, problem: `${baseFile} has no keys — the base bundle is empty or unreadable` });
    return { locales: [baseLocale], keys: 0, problems };
  }

  const locales = [...new Set([...tagsOnDisk(localesDir, shape), baseLocale])].sort((a, b) => a.localeCompare(b));
  for (const locale of locales) {
    const file = bundleFor(localesDir, locale, shape);
    if (file === undefined) {
      problems.push({ locale, problem: 'no bundle found' });
      continue;
    }
    let bundle: Map<string, unknown>;
    try {
      bundle = flatten(readBundle(file));
    } catch (error: unknown) {
      problems.push({ locale, problem: `${file}: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    for (const key of baseKeys) {
      if (!bundle.has(key)) problems.push({ locale, problem: `missing key: ${key}` });
    }
    for (const [key, value] of bundle) {
      if (!baseKeys.has(key)) {
        problems.push({ locale, problem: `extra key not in ${baseLocale}: ${key}` });
        continue;
      }
      // An empty value is reported for the base too. i18next renders `''` for a key
      // whose value is empty and for a key that is absent, so the two are the same
      // blank screen — which is why a "translated" locale can look complete in a
      // diff and be missing on the page.
      if (typeof value !== 'string' || value === '') {
        problems.push({ locale, problem: `empty value: ${key} — indistinguishable from a missing key at runtime` });
        continue;
      }
      // Placeholder parity. Substitution is by name, so a translation that drops
      // `{{count}}` renders the sentence with a hole in it and no error anywhere.
      const expected = placeholdersOf(baseBundle.get(key));
      if (expected.length === 0) continue;
      const actual = placeholdersOf(value);
      if (expected.length !== actual.length || expected.some((token, index) => token !== actual[index])) {
        problems.push({
          locale,
          problem: `placeholder mismatch at ${key}: ${locale} has ${JSON.stringify(actual)}, ${baseLocale} has ${JSON.stringify(expected)}`,
        });
      }
    }
  }

  return { locales, keys: baseKeys.size, problems };
}

/**
Every `t('key')` call site under a scope, with its inline default if it has one.

This is the only part of the check that reaches the application rather than the
bundles: the rest compare bundle to bundle, so with one shipped language the whole
per-tag body is skipped and the script reports `ALL OK` having checked nothing
about the product — it cannot see that a key was used and absent, because the
string in the bundle did not exist to be wrong *about* anything.

Dynamic keys cannot be resolved statically and are skipped rather than guessed:
a computed key that happens to start with a literal is a finding nobody can act
on, and one finding nobody can act on trains people to ignore the report.
*/
function collectCallSites(scope: CallSiteScope, baseKeys: Set<string>, baseBundle: Map<string, unknown>): LocaleProblem[] {
  const problems: LocaleProblem[] = [];
  for (const full of sourceFiles(scope)) {
    const source = readFileSync(full, 'utf8');
    // `t('…')` / `t("…")` with a string literal first argument. The key is the
    // single source of truth for what is rendered, so anything else is out of scope.
    const pattern = /\bt\(\s*(['"])((?:[^'"\\]|\\.)*)\1\s*(,)?/g;
    for (const match of source.matchAll(pattern)) {
      const key = match[2];
      if (key.includes('${') || key.includes('{{')) continue;
      const where = path.relative(process.cwd(), full) || full;
      if (!baseKeys.has(key)) {
        problems.push({
          locale: 'call-site',
          problem: `${where}: t('${key}') is not in the bundle — it renders as the inline default and is untranslatable`,
        });
        continue;
      }
      // A default that disagrees with the shipped bundle **fails**: one of the two
      // is a bug, and the default is the one that renders verbatim the day the key
      // goes missing — which is the fallback path the whole check is about.
      if (!match[3]) continue;
      const inline = readDefault(source, match.index + match[0].length);
      if (inline === null) continue;
      const bundled = baseBundle.get(key);
      if (inline !== bundled) {
        problems.push({
          locale: 'call-site',
          problem: `${where}: t('${key}', …) default disagrees with the bundle — bundle=${JSON.stringify(bundled)} default=${JSON.stringify(inline)}`,
        });
      }
    }
  }
  return problems;
}

/**
The first string literal at `from`, or `null` when the next token is not one.

The terminator is the literal's **own** quote character and never the other one.
A default that contains an apostrophe is the ordinary case here — these bundles
say things like `D1's daily write allowance` — so a scan that accepts either
quote stops at the apostrophe and reports `D1` as the whole default, turning a
correct file into a "default disagrees" failure on every line that quotes an
English possessive.
*/
function readDefault(source: string, from: number): string | null {
  const rest = source.slice(from).replace(/^\s+/, '');
  const quote = rest[0];
  if (quote !== "'" && quote !== '"') return null;
  const body = rest.slice(1);
  const closer = quote === "'" ? /^(?:[^'\\]|\\.)*'/ : /^(?:[^"\\]|\\.)*"/;
  const match = closer.exec(body);
  if (!match) return null;
  return decodeStringLiteral(body.slice(0, match[0].length - 1));
}

/**
Decode a JS string literal as written in source, escapes and all.

Only the escapes these bundles use are handled. An unrecognised one is passed
through as the backslash plus the character rather than throwing: a validator
that crashes on an unfamiliar escape reports nothing at all, which is worse than
reporting a value it had to guess at.
*/
function decodeStringLiteral(raw: string): string {
  return raw.replaceAll(/\\(.)/gs, (whole, char: string) => {
    switch (char) {
      case 'n': {
        return '\n';
      }
      case 't': {
        return '\t';
      }
      case 'r': {
        return '\r';
      }
      case '\\':
      case "'":
      case '"':
      case '`': {
        return char;
      }
      default: {
        return whole;
      }
    }
  });
}

/**
Every key a `t()` call site names literally, under one scope.

Extracted from {@link collectCallSites} so the unused-key sweep and the
unresolved-key check read the **same** set. Two scanners that each carry their
own idea of what a call site looks like disagree on exactly the interesting
case — a shape one understands and the other does not — and then report a key
as both unused and used.
*/
function usedKeys(scope: CallSiteScope): Set<string> {
  const used = new Set<string>();
  for (const file of sourceFiles(scope)) {
    // `t('…')` / `t("…")` with a string literal first argument. The key is the
    // single source of truth for what is rendered, so anything else is out of scope.
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*(['"])((?:[^'"\\]|\\.)*)\1/g)) {
      const key = match[2];
      if (!key.includes('${') && !key.includes('{{')) used.add(key);
    }
  }
  return used;
}

/**
Every source file a scope covers, walking the skip list once.
*/
function sourceFiles(scope: CallSiteScope): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage') continue;
        walk(full);
        continue;
      }
      if (scope.extensions.some((extension) => entry.name.endsWith(extension))) files.push(full);
    }
  };
  walk(scope.dir);
  return files;
}

/**
Base-bundle keys that no `t()` call site reaches.

Advisory by construction, and for the reason {@link LocaleProblem.advisory}
gives: a bundle routinely runs ahead of its UI, and a translator adding a
string for a screen that has not been wired is doing the right thing. What it
also catches is the case that matters — a renamed or deleted call site whose
key was never removed, which keeps a translator re-translating a string no
user will ever see.

Dynamic keys are **not** reported as unused. `` t(`section.${name}`) `` cannot
be resolved statically, so every key under that prefix would look dead; the
honest answer is "unknown", and an `unknown` reported as `unused` is the kind
of finding that makes a gate useless.
*/
function collectUnusedKeys(baseKeys: readonly string[], scope: CallSiteScope, used: Set<string>): LocaleProblem[] {
  const prefixes = dynamicKeyPrefixes(scope);
  const unused = baseKeys.filter(
    (key) => !used.has(key) && [...prefixes].every((prefix) => !(key === prefix || key.startsWith(`${prefix}.`))),
  );
  if (unused.length === 0) return [];
  return [
    {
      locale: 'call-site',
      problem: `${unused.length} base key(s) are not reached by any t() call site: ${unused.slice(0, 20).join(', ')}${unused.length > 20 ? ', …' : ''}`,
      advisory: true,
    },
  ];
}

/**
The longest literal prefix of every dynamically-built key.

A prefix rather than a whole key, because only the static head of
`` t(`nav.${item}`) `` is knowable, and the keys it may resolve to are exactly
the ones a static scan must not claim are dead.
*/
function dynamicKeyPrefixes(scope: CallSiteScope): Set<string> {
  const prefixes = new Set<string>();
  for (const file of sourceFiles(scope)) {
    for (const match of readFileSync(file, 'utf8').matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) {
      const head = match[1].replace(/\.$/, '');
      if (head) prefixes.add(head);
    }
  }
  return prefixes;
}

/**
The string tags a locale directory declares, parsed from a source file.

A declared list and a directory of bundles are two independent facts about the
same thing, and the only one that can be wrong *silently* is the declared list:
a tag with no directory makes a runtime `import.meta.glob` lookup throw the
moment that language is chosen, which is a support ticket and not a build
failure. A directory with no declaration is a translation nobody can select.

Parsed as text rather than imported, because the declaring file is a TypeScript
module in the app being linted and importing it would run it.
*/
function declaredTags(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const match = /(?:export\s+)?const\s+(?:SUPPORTED_LANGUAGES|SUPPORTED_LOCALES)\s*=\s*\[([^\]]*)\]/.exec(source);
  if (!match) throw new Error(`${file} declares no SUPPORTED_LANGUAGES/SUPPORTED_LOCALES array literal`);
  return [...(match[1] ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((tag) => tag[1]);
}

/**
Cross-check a declared tag list against the bundle directories, both ways.

Both directions are findings because both are wrong states: declared-but-absent
is a runtime throw on selection, present-but-undeclared is a bundle no
selector offers.
*/
function checkDeclaredTags(localesDir: string, declaredFile: string, onDisk: readonly string[]): LocaleProblem[] {
  const declared = declaredTags(declaredFile);
  const problems: LocaleProblem[] = [];
  for (const tag of declared) {
    if (!onDisk.includes(tag)) {
      problems.push({
        locale: 'tags',
        problem: `${declaredFile} declares '${tag}' but ${localesDir}/${tag} does not exist — selecting that language throws`,
      });
    }
  }
  for (const tag of onDisk) {
    if (!declared.includes(tag)) {
      problems.push({
        locale: 'tags',
        problem: `${localesDir}/${tag} exists but ${declaredFile} does not declare it — the selector cannot offer it`,
      });
    }
  }
  return problems;
}

/**
CLI entry: `validateLocalesCli(['[locales-dir]?', '--shape=auto|dir|file|module'?, '--base=<tag>'?, '--call-sites=<src-dir>'?, '--tags=<file>'?])`.

`--call-sites=<dir>` opts into the application-side checks: every `t('key')` under
`<dir>` must resolve against the base bundle, and any inline default must equal the
bundled value. Without the flag the script stays bundle-to-bundle, because that is
the only part it can answer for a repo whose bundles are consumed by something
other than `t()` — a backend string table, for instance.

`--tags=<file>` cross-checks a declared `SUPPORTED_LANGUAGES` / `SUPPORTED_LOCALES`
array against the bundle directories, in both directions. It is separate from
`--call-sites` because a repo can declare its tags in a file the scan never walks,
and a directory of bundles with no declaration is exactly the state a
bundle-to-bundle check reports as perfectly healthy.
*/
function validateLocalesCli(argv: readonly string[] = process.argv.slice(2)): number {
  const dir = argv.find((arg) => !arg.startsWith('--')) ?? 'apps/web/src/locales';
  const shape = (argv.find((arg) => arg.startsWith('--shape='))?.slice('--shape='.length) ?? 'auto') as LocaleShape;
  const base = argv.find((arg) => arg.startsWith('--base='))?.slice('--base='.length) ?? 'en';
  const callSiteDir = argv.find((arg) => arg.startsWith('--call-sites='))?.slice('--call-sites='.length);
  const tagsFile = argv.find((arg) => arg.startsWith('--tags='))?.slice('--tags='.length);

  const report = validateLocales(dir, base, shape);
  const problems = [...report.problems];

  if (tagsFile !== undefined && existsSync(tagsFile)) {
    try {
      problems.push(...checkDeclaredTags(dir, tagsFile, tagsOnDisk(dir, shape)));
    } catch (error: unknown) {
      problems.push({ locale: 'tags', problem: `${tagsFile}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  if (callSiteDir !== undefined && existsSync(callSiteDir)) {
    try {
      const baseBundle = bundleAt(dir, base, shape);
      const scope = { dir: callSiteDir, extensions: ['.ts', '.tsx'] };
      const used = usedKeys(scope);
      problems.push(
        ...collectCallSites(scope, new Set(baseBundle.keys()), baseBundle),
        ...collectUnusedKeys([...baseBundle.keys()], scope, used),
      );
    } catch (error: unknown) {
      problems.push({ locale: 'call-site', problem: `${callSiteDir}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const failures = problems.filter((problem) => problem.advisory !== true);
  const advisories = problems.filter((problem) => problem.advisory === true);

  if (failures.length > 0) {
    console.error(`Locale validation failed for ${dir} (${failures.length} problem(s)):`);
    for (const problem of failures) console.error(`  - ${problem.locale}: ${problem.problem}`);
    return 1;
  }
  if (advisories.length > 0) {
    console.warn(`Locale validation passed for ${dir} with ${advisories.length} advisory finding(s):`);
    for (const problem of advisories) console.warn(`  - ${problem.locale}: ${problem.problem}`);
  }
  console.log(`Locale validation passed (${report.locales.length} locales, ${report.keys} keys each, shape ${shape}).`);
  return 0;
}

export { parseObjectLiteral, validateLocales, validateLocalesCli };
export type { LocaleProblem, LocaleReport, LocaleShape };

// Run only when this file is the entrypoint.
//
// The rules above are pure and the tests import them directly, so a module-level
// call would shell out (and exit) during a test run. The URL comparison rather than
// an unconditional call is the same guard Durable-DAV's init-secrets.ts uses, and
// it is what keeps the rule modules importable — which is the whole reason they are
// separate modules in the first place.
if (isEntrypoint(import.meta.url)) {
  process.exit(validateLocalesCli(process.argv.slice(2)));
}
