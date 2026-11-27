# Agent-Router — Runtime And Configuration

Scope: Wrangler bindings, build output, env vars. Parent index: `../../../AGENTS.md`.

- Root `@agent-router/monorepo`, pnpm workspaces (`apps/*`, `packages/*`).
- `apps/web/vite.config.ts` proxies `/user` + `/v1` + `/anthropic` + `/gemini` → `http://localhost:8787` in dev; `closeBundle` embeds `dist/index.html` into `apps/api/src/generated/spa-shell.ts` (`SPA_HTML`) on build.
- `apps/api/wrangler.template.jsonc` is the config template — copy to `wrangler.jsonc` per deployer; no committed `wrangler.jsonc`. Local `wrangler.jsonc` uses `DEV_AUTH_EMAIL=test@example.com`.
- The Worker serves the SPA from `/`, `/settings`, `/providers`, `/keys`, `/usage`, `/user/*` catch-all in `AgentRouterWorker` (non-matching paths return `404`); proxy paths (`/v1/*`, `/anthropic/*`, `/gemini/*`) never hit the catch-all.
- Bindings: D1 `DB`, DO `CRON_TASKS` (`CronTasksWorker`, `idFromName('global')`), DO `PROXY_GATEWAY` (`ProxyGateway`, `idFromName('key:'+gatewayKeyId)`, migration `v1000000001`), cron `*/10 * * * *`; no KV/R2/Queues/AI bindings. DO migrations are append-only: the `v1000000001` tag with `new_sqlite_classes: ["ProxyGateway"]` must be present on the first deploy that exports the class (renaming either later needs a new tag).
- CPU ceilings: Workers and Durable Objects both default to 30 s per invocation. On Workers Paid, raise it with `WRANGLER_PATCH_JSON='{"limits":{"cpu_ms":300000}}'` (`applyTopLevelPatch` already handles top-level keys) — do not put `cpu_ms` in the template while the deployment is Free. Separately, proxy streaming responses are relayed, never buffered, so the proxy path stays well under the default.
- Secrets: `PROVIDER_KEYS_ENCRYPTION_SECRET` (Secrets Store, static upstream-key encryption) + `CODEX_OAUTH_ENCRYPTION_SECRET` (Secrets Store, Codex OAuth token encryption) + `COMMAND_CODE_FINGERPRINT_SALT` (Secrets Store, deterministic Command Code device fingerprints) + `WEB_SEARCH_ENCRYPTION_SECRET` (Secrets Store, encryption of per-user Brave/Tavily credentials). CD provisions every declared secret through `scripts/init-secrets.ts`; add a generator there for each new `secrets_store_secrets` entry. Command Code protocol knobs (`COMMAND_CODE_PROTOCOL_VERSION`, `COMMAND_CODE_DEVICE_PROJECT_DIR`, `COMMAND_CODE_CLI_MODE`, `COMMAND_CODE_CLI_SESSION_MODE`, `COMMAND_CODE_EMPTY_SYSTEM_PLACEHOLDER`, `COMMAND_CODE_ZDR`, `COMMAND_CODE_MAX_BODY_BYTES`, `COMMAND_CODE_TIMEOUT_MS`, `COMMAND_CODE_STREAM_IDLE_MS`, `COMMAND_CODE_STREAM_HEARTBEAT_MS`, `COMMAND_CODE_MAX_TOOL_IMAGE_MB`, `COMMAND_CODE_MODELS_TTL_MS`) are plain vars surfaced through `CommandCodeLimits`. Stream idle guards absence of upstream bytes only (default 120 s); SSE comment heartbeats (default 15 s) keep clients alive until the first token.

## Required vars (no defaults)

`POLICY_AUD`, `TEAM_DOMAIN` — Cloudflare Access JWT verification (`AccessAuthService`). No default; requests fail without them (except `DEMO_MODE`/`DEV_AUTH_EMAIL` bypass).

## Local-only (no default, not in `ConfigurationDefaults.ts`)

`DEV_AUTH_EMAIL` — bypasses Cloudflare Access locally. `DEMO_MODE` — returns `DEMO_USER_EMAIL` without verification.

## Optional vars (defaults in `ConfigurationDefaults.ts`)

| Group  | Vars (default)                                                                                                                                                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App    | `DEBUG_MODE` (`false`), `SITE_URL` (`""`)                                                                                                                                                                                                                                                                                                        |
| Router | `MAX_PROVIDERS_PER_USER` (`10`), `MAX_KEYS_PER_PROVIDER` (`10`), `MAX_GATEWAY_KEYS_PER_USER` (`10`), `MAX_GATEWAY_KEY_EXPIRY_DAYS` (`365`), `PROXY_TIMEOUT_MS` (`30000`), `PROXY_MAX_ATTEMPTS` (`4`), `PROXY_MAX_BODY_BYTES` (`1048576`), `KEY_COOLDOWN_BASE_MS` (`60000`), `KEY_MAX_CONSECUTIVE_FAILURES` (`10`), `USAGE_RETENTION_DAYS` (`90`) |

Add new env vars in `ConfigurationDefaults.ts` (+ `ConfigurationManager` getter + `AppConfiguration` method + `RouterLimits` section where applicable), not inline.

## Dependency injection (`packages/backend-runtime/src/di/` + `config/`)

- `AppConfiguration` — injectable instance view over env parsing (one method per setting, incl. `RouterLimits` for gateway settings); `ConfigurationManager` statics remain as thin facade. Prefer injecting `AppConfiguration` in new services; mock via constructor deps.
- `Container` — minimal Factory + Singleton DI (`bind`/`bindValue`/`get`/`resolve`/`createChild`). `createRequestScope(env)` in `backend-services/composition` is the standard composition root (table-driven lazy DAO wiring + memoized Secrets Store `Keys`; `scope.get(Tokens.X)`). `scopeMiddleware` installs a single scope per request.
- `createServiceContext(env, overrides?)` — single request-scoped `{ env, logger, clock }`; prefer extending `ServiceContext` over new `*Env` interfaces; never reintroduce `as` env casts.
- Helpers: `memoizeAsync` (composition-root memoization), `NullLogger`/`FixedClock` (test doubles), `setRequestScope/getRequestScope/getServiceContext` (request plumbing).
