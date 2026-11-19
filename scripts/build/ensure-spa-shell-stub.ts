#!/usr/bin/env tsx
/**
Write a placeholder `apps/api/src/generated/spa-shell.ts` when it is absent.

Provenance: Durable-DAV's `scripts/ensure-spa-shell-stub.mjs` and Edge-Sonic's
`scripts/build/ensure-spa-shell-stub.ts`. The rule lives in `spa-shell.ts`; this
is the entrypoint that runs it from `postinstall`.

`pnpm install` runs this before `typegen` so the API worker typechecks in a
fresh clone, where the real file has not been produced by the Vite build yet.
It exits having done nothing when the file already exists, so a real build
output is never overwritten — overwriting would erase the last build with a
stub on the next install. The file is gitignored.

Usage, from the repo root (typically wired as `postinstall`):

```bash
pnpm exec tsx scripts/ensure-spa-shell-stub.ts [repo-root]
```
*/
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSpaShellStub } from './spa-shell.ts';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = process.argv[2] === undefined ? REPOSITORY_ROOT : path.resolve(process.argv[2]);

const result = ensureSpaShellStub({ root });

console.log(
  result.created
    ? `ensure-spa-shell-stub: created stub at ${result.path}`
    : `ensure-spa-shell-stub: ${result.path} already present, left untouched`,
);
