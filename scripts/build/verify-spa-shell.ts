#!/usr/bin/env tsx
/**
Fail when the SPA shell the API worker serves is missing or self-inconsistent.

Provenance: Durable-DAV's and Durable-DAV-Router's `scripts/verify-spa-shell.mjs`
and Edge-Sonic's typed `scripts/build/verify-spa-shell.ts`. The rules — which of
the ways a shell can be wrong to look for — live in `spa-shell.ts`, so they are
unit tested without a build on disk; this file is the entrypoint that turns the
verdict into an exit code.

What it catches:

- the `postinstall` stub, or no build at all, still in place;
- `spa-shell.ts` referencing `/assets/...` bundles that were not emitted (a
  partially cleaned or half-copied `dist/`, which serves a shell whose JS 404s
  and therefore renders no operator UI at all);
- `spa-shell.ts` and `apps/web/dist/index.html` disagreeing, i.e. only one of
  the two halves of the build was refreshed.

**The build is a precondition of this check, not a convenience.** Both paths are
gitignored and `postinstall` writes a deliberately empty stub, so verifying
without building cannot pass — and it fails with precisely the message above,
which is the check working rather than the check being wrong.

Usage, from the repo root:

```bash
pnpm exec tsx scripts/verify-spa-shell.ts            # defaults to ./ as root
pnpm exec tsx scripts/verify-spa-shell.ts --root /path/to/repo
```
*/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySpaShell } from './spa-shell.ts';

/**
The repository root, derived from this file rather than from `process.cwd()`.

Two levels up, because this file sits in `scripts/`. Deriving it means the gate
reads the same tree whatever directory it is invoked from — which is the
difference between a gate and a gate that passes because nobody ran it from the
right place.
*/
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const root = process.argv[2] === undefined ? REPOSITORY_ROOT : path.resolve(process.argv[2]);

const { problems } = verifySpaShell({ root });

if (problems.length > 0) {
  console.error('SPA shell check failed:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `SPA shell check passed (${path.join(root, 'apps/api/src/generated/spa-shell.ts')} matches ${path.join(root, 'apps/web/dist')}).`,
);
