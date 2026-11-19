# Agent-Router — Working In This Repository

Scope: the workspace layout, the commands, the layer rules and the gates a change has to pass.
Parent index: [`../../../AGENTS.md`](../../../AGENTS.md).

This is the mechanical part: what exists, what runs it, and what refuses to merge. Design
decisions live in the area guides.

## The workspace

`pnpm-workspace.yaml` globs `apps/*`, `packages/*` and `test` — **nine projects**: three apps,
five packages and the test suite.

| Layer | Projects                                                                                                                | May import                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 0     | SDK `@rexezuge/shared`, `@rexezuge/errors`                                                                              | nothing                                                                    |
| 0     | `packages/shared`                                                                                                       | SDK layer 0                                                                |
| 1     | `packages/backend-runtime`                                                                                              | layer 0                                                                    |
| 2     | `packages/backend-data`                                                                                                 | layer 0                                                                    |
| 3     | `packages/provider-clients`                                                                                             | layer 0                                                                    |
| 3     | `packages/backend-services`                                                                                             | layers 0–2, provider-clients                                               |
| 5     | `apps/background`                                                                                                       | layers 0–3                                                                 |
| 5     | `apps/api`                                                                                                              | layers 0–3 + background; **not** `provider-clients` or DAOs (type-only ok) |
| —     | `apps/web`                                                                                                              | the browser, `@rexezuge/web`; no backend package                            |

Enforced by `defineRepoLintConfig` from `@rexezuge/tooling/eslint` in `eslint.config.mjs`, with
one repo-specific `apps/api` entry.

## Gates

`pnpm run checks` is the full local gate:

| Step                     | Runs                                                     |
| ------------------------ | -------------------------------------------------------- |
| `typecheck`              | every project + `scripts/` + `functions/`                |
| `lint`                   | the factory config, tests and scripts included           |
| `check:god-files`        | 300 warn / 400 critical, warn-only until splits land     |
| `validate:migrations`    | filename order, contiguity, digest lock                   |
| `validate:locales`       | `en` / `zh-CN` key, placeholder and shape parity          |
| `verify:spa-shell`       | the embedded shell matches `apps/web/dist`               |
| `test:coverage`          | unit suite with the coverage floors in `vitest.config.mts` |
| `test:integration`       | workerd + real D1 under `@cloudflare/vitest-pool-workers` |

CI splits these into named jobs (`.github/workflows/continuous-integration.yml`) so a failure
names the tool. `continuous-deployment.yml` runs only after a green CI on `main`;
`backup-d1.yml` is secret-gated and stays green when no destination is configured.

## Tooling comes from the SDK

- `eslint.config.mjs` → `defineRepoLintConfig`
- `vitest.config.mts` → `defineRepoVitestConfig`
- `test/integration/vitest.config.mts` → `defineIntegrationVitestConfig`
- `apps/web/vite.config.ts` → `defineWebViteConfig` + `spaShellEmbedPlugin`
- `functions/[[path]].ts` → `createPagesProxy`
- `scripts/**` → the kit's god-file, locale, migration, SPA-shell and backup modules

Do not re-implement a factory locally. A difference that is genuinely this repo's is an
argument to the factory, not a copy of it.

## Generated files

`wrangler.jsonc`, `worker-configuration.d.ts`, `apps/api/src/generated/spa-shell.ts` and
`apps/web/dist/` are generated and gitignored. `postinstall` writes the shell stub so a fresh
clone typechecks; `pnpm --filter @agent-router/web build` writes the real one.
