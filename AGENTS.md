# AGENTS.md

Agent-Router: OpenRouter-style LLM gateway (`@agent-router/monorepo`, `pnpm@11.2.2`).

- **Gateway core**: `packages/router` logic lives in `packages/backend-services/src/router` (`RouterService` failover loop + `UpstreamClient` per-kind calls) over `packages/backend-data` DAOs (`ProviderDAO`, `ProviderKeyDAO`, `GatewayKeyDAO`, `UsageLedgerDAO`, `UserDAO`).
- **Storage**: D1 `migrations/0001_agent_router.sql` (`users`, `gateway_keys`, `providers`, `provider_keys`, `usage_ledger`; legacy schema archived in `migrations/_archive/`) + `migrations/0002_codex_oauth.sql` (OAuth columns on `provider_keys`, `codex_oauth_sessions`). Upstream secrets AES-GCM encrypted via Secrets Store (`PROVIDER_KEYS_ENCRYPTION_SECRET` for static keys, `CODEX_OAUTH_ENCRYPTION_SECRET` for Codex OAuth tokens, `KeyCrypto` with per-feature purpose).
- **Auth**: `/user/*` Cloudflare Access (`AccessAuthService`: DEMO→DEV→JWT→`ctx.access` fallback; never trust `Cf-Access-Authenticated-User-Email`); proxy paths use gateway-key Bearer (`GatewayKeyService`, sha256 `agent-router-gw:` prefix, `ar_…` display).
- **API**: `apps/api` Hono `AgentRouterWorker` (`POST /v1/chat/completions|embeddings|responses`, `GET /v1/models`, `POST /anthropic/v1/messages`, `POST /gemini/v1beta/models/:action` + `/user/providers|gateway-keys|usage|me` (providers include Codex device-code + token-import endpoints) + `/health`, `/docs`); model-prefix routing with `x-provider-id` override (`OPENAI` falls back to `OPENAI_CODEX` for `/v1/responses` only; Codex serves the Codex backend, not platform chat/embeddings).
- **Web**: `apps/web` Vite SPA, build embeds `dist/index.html` → `apps/api/src/generated/spa-shell.ts`.
- **Composition**: single scope per request via `scopeMiddleware` (`getScope(c).get(Tokens.X)`; `createRequestScope(env)` is the composition root, table-driven DAO wiring); `Container` + `createServiceContext` + `AppConfiguration` + `memoizeAsync`/`NullLogger`/`FixedClock` in `@agent-router/backend-runtime/di+config` are the DI foundation. See `docs/agents/runtime/AGENTS.md`.
- **i18n**: web i18next (`en`+`zh-CN` bundles, single `canonicalizeLanguageTag` in `i18n.ts`); English UI text uses Title Case. See `apps/web/AGENTS.md`.

## Commands

```bash
pnpm install
pnpm -r typecheck && pnpm exec vitest run
pnpm --filter @agent-router/web build
pnpm run typegen
pnpm exec wrangler dev --config ./wrangler.jsonc
```

No committed `wrangler.jsonc`. God-file guard 300/400 warn-only.

## Layers

```
shared, backend-errors → 0 deps
backend-runtime → 0 only
backend-data → 0 only
backend-services → 0-2 (not apps)
background → 0-3
api → 0-3 + background (no DAO value imports in endpoints)
```

## Import Direction

```
Layer 0: shared, backend-errors          — zero @agent-router/* deps
Layer 1: backend-runtime                 → layer 0 only
Layer 2: backend-data                    → layer 0 only
Layer 3: backend-services                → layers 0–2 (not apps)
(no Layer 4 by design)
Layer 5: apps/background                 → layers 0–3 (not apps/api)
         apps/api                        → layers 0–3 + background (NOT backend-data/dao except type-only)
```

Enforced by ESLint `no-restricted-imports` in `eslint.config.mjs`.

## Index

| Area                                            | Guide                                 |
| ----------------------------------------------- | ------------------------------------- |
| API worker, auth, routes                        | `apps/api/AGENTS.md`                  |
| Background worker, cron phases                  | `apps/background/AGENTS.md`           |
| Web SPA, router, i18n/Title Case conventions    | `apps/web/AGENTS.md`                  |
| Business logic, service domain map              | `packages/backend-services/AGENTS.md` |
| D1/DAO layer                                    | `packages/backend-data/AGENTS.md`     |
| Bindings, wrangler, env vars, DI                | `docs/agents/runtime/AGENTS.md`       |
| Tests, thresholds, mock patterns                | `docs/agents/testing/AGENTS.md`       |
