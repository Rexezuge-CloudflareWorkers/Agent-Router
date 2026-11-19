# scripts/

Repo tooling, grouped by who runs it. Every script is TypeScript and is covered by `pnpm run lint` and `pnpm run typecheck:scripts`.

| Directory     | Runs from             | Purpose                                                               |
| ------------- | --------------------- | --------------------------------------------------------------------- |
| `lib/`        | imported              | Reusable helpers. No side effects on import.                          |
| `build/`      | `pnpm install`        | Keeps a fresh clone typecheckable before the first build.             |
| `deploy/`     | `deploy-worker` job   | Materialize `wrangler.jsonc` and provision its resources and secrets. |
| `i18n/`       | a human, or CI        | Web locale validation (also in `pnpm run checks` and CI).             |
| `migrations/` | a human, or CI        | The migration checksum lock.                                          |

## Entrypoint vs module convention

- An **entrypoint** starts with `#!`, runs at top level, and exports nothing.
- A **module** has no `#!` and exports freely. Testable guards and shared helpers live here.

`deploy/prepare-wrangler-config.ts` is the clearest example: it is five ordered calls into `lib/wrangler-config/`.

## lib/

| Module                         | Contents                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `wrangler-config/types.ts`     | `wrangler.jsonc` paths, placeholder ids (`DEFAULT_UUID`, `DEFAULT_HEX_ID`), config interfaces.        |
| `wrangler-config/cli.ts`       | `runWrangler`, `parseJsonArray`.                                                                      |
| `wrangler-config/patches.ts`   | Read/rewrite `wrangler.jsonc`, `WRANGLER_JSONC` / `WRANGLER_PATCH_JSON` / `WRANGLER_VARS_PATCH_JSON`. |
| `wrangler-config/resources.ts` | Create missing D1 / KV / Secrets Store resources and patch their ids in.                              |
| `entrypoint.ts`                | `isEntrypoint` — the guard that keeps a module importable by tests.                                   |

CI entrypoints are runnable from a local shell with the same flags Actions uses.
