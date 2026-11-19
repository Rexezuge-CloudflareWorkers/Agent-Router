# Agent-Router — Index

**Agent-Router** is an OpenRouter-style LLM gateway on Cloudflare Workers: a Hono API, a cron
Durable Object, a Vite React SPA and a proxy Durable Object in one pnpm workspace. Callers use
either the Cloudflare Access `/user/*` surface or an `ar_…` gateway key against the OpenAI,
Anthropic, Gemini, Codex and Command Code upstreams. The gateway owns failover, key cooldown,
usage accounting and per-provider request shapes; secrets live AES-GCM-encrypted in the
Secrets Store.

`@agent-router/*` is the product. Everything shared with the sibling repositories is the
published `@rexezuge/*` SDK — errors, runtime (DI/config/logger/worker bases), D1 retry and
types, HTTP helpers, web primitives and repo tooling. **The kit follows the best design; this
repo adapts.**

## Guides

| Area                                             | Guide                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| Workspace, layers, commands, gates, CI           | [`docs/agents/repo/AGENTS.md`](docs/agents/repo/AGENTS.md)         |
| API worker, auth, routes, proxy Durable Object   | [`apps/api/AGENTS.md`](apps/api/AGENTS.md)                         |
| Background worker, cron phases                   | [`apps/background/AGENTS.md`](apps/background/AGENTS.md)           |
| Web SPA, router, i18n, Title Case                | [`apps/web/AGENTS.md`](apps/web/AGENTS.md)                         |
| Business logic, service domain map               | [`packages/backend-services/AGENTS.md`](packages/backend-services/AGENTS.md) |
| D1/DAO layer                                     | [`packages/backend-data/AGENTS.md`](packages/backend-data/AGENTS.md) |
| Raw upstream clients                             | `packages/provider-clients/src`                                    |
| Bindings, wrangler, env vars, DI                 | [`docs/agents/runtime/AGENTS.md`](docs/agents/runtime/AGENTS.md)   |
| Tests, thresholds, mock patterns                 | [`docs/agents/testing/AGENTS.md`](docs/agents/testing/AGENTS.md)   |

## The shape

```
apps/       api (Hono worker + ProxyGateway DO) · background (cron DO) · web (Vite SPA)
packages/   shared · backend-runtime · backend-data · provider-clients · backend-services
test/       one workspace project; unit, integration, mocks
scripts/    lib/ build/ deploy/ i18n/ migrations/ backup/
migrations/ D1 schema + migrations.lock.json
```

## Invariants

- **One request, one scope.** `scopeMiddleware` installs a `Container` and a
  `ServiceContext`; handlers resolve through `getScope(c).get(Tokens.X)`. Never build a scope
  per handler.
- **The API never touches DAOs or raw upstream clients.** It calls `backend-services` through
  the scope. There is no `provider-clients` or `backend-data/dao` import under `apps/api`.
- **Secrets are always encrypted at rest.** `PROVIDER_KEYS_ENCRYPTION_SECRET`,
  `CODEX_OAUTH_ENCRYPTION_SECRET` and `COMMAND_CODE_FINGERPRINT_SALT` come from the Secrets
  Store; `KeyCrypto` owns the purpose strings.
- **No committed `wrangler.jsonc`.** It is generated from `apps/api/wrangler.template.jsonc` by
  `scripts/deploy/prepare-wrangler-config.ts`; `worker-configuration.d.ts` is generated too.
- **Migrations are append-only.** `migrations.lock.json` pins each file's digest;
  `pnpm run validate:migrations` fails on an edit, a gap or an orphan.

## Commands

```bash
pnpm install
pnpm run checks          # fast gates + coverage + integration
pnpm run typecheck
pnpm run lint
pnpm run test            # unit
pnpm run test:integration
pnpm --filter @agent-router/web build
pnpm exec wrangler dev --config ./wrangler.jsonc
```

## Commit policy

Format `<TYPE>[scope]: <Description>`; branch off `main` as `type/description`; include a
Markdown body and the attribution footers. See the root `AGENTS.md` instructions loaded by
the harness.
