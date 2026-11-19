import { isEntrypoint } from '../lib/entrypoint.ts';
/**
The SPA shell pair: `ensure-spa-shell-stub` + `verify-spa-shell`.

Provenance: the `scripts/ensure-spa-shell-stub.mjs` +
`scripts/verify-spa-shell.mjs` pair (Durable-DAV) and Edge-Sonic's typed
`scripts/build/{ensure-spa-shell-stub,spa-shell-checks,verify-spa-shell}.ts`.
The generate step itself is a Vite plugin (`spaShellEmbedPlugin` in
`vite.ts`) because it must run on every build; this module holds the
freshness contract around the generated file.

Why the pair exists: `apps/api/src/generated/spa-shell.ts` and
`apps/web/dist/` are both gitignored build artifacts. A fresh clone gets the
empty postinstall stub and every browser navigation returns a blank page,
with nothing in the source tree saying so.
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

interface SpaShellPaths {
  /**
  Repo root.
  */
  root: string;
  /**
  Generated TS module path, relative to root.
  */
  shellPath?: string;
  /**
  Built SPA index.html path, relative to root.
  */
  distIndexPath?: string;
}

interface VerifyResult {
  problems: string[];
}

const DEFAULT_SHELL = 'apps/api/src/generated/spa-shell.ts';
const DEFAULT_DIST_INDEX = 'apps/web/dist/index.html';
const STUB_CONTENT =
  "// Auto-generated stub - real content is produced by the build step via the Vite plugin.\nexport const SPA_HTML: string = '';\n";

/**
A built shell is a full Vite index.html; any small threshold rejects the stub.
*/
const MIN_HTML_CHARS = 200;

function resolvePaths(options: SpaShellPaths): { shell: string; distIndex: string; distAssets: string } {
  const root = path.resolve(options.root);
  const shell = path.join(root, options.shellPath ?? DEFAULT_SHELL);
  const distIndex = path.join(root, options.distIndexPath ?? DEFAULT_DIST_INDEX);
  return { shell, distIndex, distAssets: path.join(path.dirname(distIndex), 'assets') };
}

/**
Create the empty stub when (and only when) nothing is there yet, so a fresh
clone typechecks and `pnpm run build` regenerates the real thing. Never
overwrites an existing file — overwriting would erase a real build with a
stub on the next `pnpm install`.
*/
function ensureSpaShellStub(options: SpaShellPaths): { created: boolean; path: string } {
  const { shell } = resolvePaths(options);
  mkdirSync(path.dirname(shell), { recursive: true });
  try {
    writeFileSync(shell, STUB_CONTENT, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
      return { created: false, path: shell };
    }
    throw error;
  }
  return { created: true, path: shell };
}

/**
The `SPA_HTML` string literal, decoded from the generated TS module.
*/
function readEmbeddedHtml(shell: string, problems: string[]): string | null {
  if (!existsSync(shell)) {
    problems.push(`${shell} is missing — run the build (only apps/web has a build step).`);
    return null;
  }
  const source = readFileSync(shell, 'utf8');
  const marker = 'export const SPA_HTML: string = ';
  const at = source.indexOf(marker);
  if (at === -1) {
    problems.push(`${shell} does not export SPA_HTML — regenerate it with the build.`);
    return null;
  }
  const literal = source.slice(at + marker.length).replace(/;\s*$/, '');
  if (literal === "''" || literal === '""') {
    problems.push(
      `${shell} still holds the empty postinstall stub — run the build. Until then every browser navigation served by the API worker is a blank page.`,
    );
    return null;
  }
  let html: unknown;
  try {
    html = JSON.parse(literal);
  } catch {
    problems.push(`${shell} is not the generated shape — delete it and run the build.`);
    return null;
  }
  if (typeof html !== 'string' || html.length < MIN_HTML_CHARS) {
    problems.push(`${shell} holds no usable HTML — run the build. Until then every browser navigation is a blank page.`);
    return null;
  }
  return html;
}

/**
Fail when the shell the API worker serves is missing or self-inconsistent:

- the postinstall stub (or no build at all) still in place;
- `/assets/...` bundles referenced but not emitted (a half-cleaned dist,
  which serves a shell whose JS 404s);
- `spa-shell.ts` and `dist/index.html` disagreeing — only one half of the
  build was refreshed.

Known limit, stated rather than papered over: a *stale but self-consistent*
pair passes. That class is covered at the source level by each repo's SPA
parser integration test; the remaining duty is operational — run the build
after touching `apps/web`, before deploy.
*/
function verifySpaShell(options: SpaShellPaths): VerifyResult {
  const { shell, distIndex, distAssets } = resolvePaths(options);
  const problems: string[] = [];
  const html = readEmbeddedHtml(shell, problems);
  if (html === null) {
    return { problems };
  }
  const referenced = [...html.matchAll(/(?:src|href)="\/assets\/([^"]+)"/g)].map((match) => match[1]);
  if (referenced.length === 0) {
    problems.push('The embedded shell references no /assets/ bundles — it is not a real build output.');
  }
  for (const asset of new Set(referenced)) {
    if (!existsSync(path.join(distAssets, asset))) {
      problems.push(`The embedded shell references /assets/${asset}, which is not in ${distAssets} — run the build.`);
    }
  }
  if (!existsSync(distIndex)) {
    problems.push(`${distIndex} is missing — run the build.`);
  } else if (readFileSync(distIndex, 'utf8') !== html) {
    problems.push(`${shell} does not match ${distIndex} — run the build.`);
  }
  return { problems };
}

const CLI_SHAPES = 'verify|ensure';

/**
CLI entry: `spaShellCli(['verify'|'ensure', 'repo-root?'])`.
*/
function spaShellCli(argv: readonly string[] = process.argv.slice(2)): number {
  const mode = argv[0] ?? 'verify';
  if (!CLI_SHAPES.split('|').includes(mode)) {
    console.error(`Usage: tsx spa-shell.ts <${CLI_SHAPES}> [repo-root]`);
    return 1;
  }
  const options: SpaShellPaths = { root: argv[1] ?? process.cwd() };
  if (mode === 'ensure') {
    const result = ensureSpaShellStub(options);
    if (result.created) {
      console.log(`ensure-spa-shell-stub: created stub at ${result.path}`);
    } else {
      console.log(`ensure-spa-shell-stub: ${result.path} already present, left untouched`);
    }
    return 0;
  }
  const { problems } = verifySpaShell(options);
  if (problems.length > 0) {
    console.error('SPA shell check failed:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }
  console.log('SPA shell check passed.');
  return 0;
}

export { ensureSpaShellStub, spaShellCli, verifySpaShell };
export type { SpaShellPaths, VerifyResult };

// Run only when this file is the entrypoint.
//
// The rules above are pure and the tests import them directly, so a module-level
// call would shell out (and exit) during a test run. The URL comparison rather than
// an unconditional call is the same guard Durable-DAV's init-secrets.ts uses, and
// it is what keeps the rule modules importable — which is the whole reason they are
// separate modules in the first place.
if (isEntrypoint(import.meta.url)) {
  process.exit(spaShellCli(process.argv.slice(2)));
}
