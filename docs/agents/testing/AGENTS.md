# Agent-Router — Testing

Scope: unit tests (`test/*.test.ts`, `pnpm test`) + Workers integration tests (`test/integration/`, `pnpm run test:integration`). Parent index: `../../../AGENTS.md`.

## Integration Tests (`test/integration/`, ported from Otter)

- Harness: `vitest.config.mts` (`@cloudflare/vitest-pool-workers`, `*.int.test.ts`), `wrangler.test.jsonc` (D1 `DB` + `PROVIDER_KEYS_ENCRYPTION_SECRET` + `CODEX_OAUTH_ENCRYPTION_SECRET` + DO `PROXY_GATEWAY`; no `CRON_TASKS` binding — the scheduled entrypoint is not exercised), `self.ts` (re-exports the API entry, including the `ProxyGateway` class the binding resolves), `helpers/migrations.ts` (comment-aware SQL splitter), `helpers/setup.ts` (migrations + secrets-store + user seed).
- Migration SQL is concatenated from top-level `migrations/*.sql` only.
- V8 coverage does not work under the workers pool; run without `--coverage` (thresholds omitted intentionally).
- Suites: `health.int.test.ts` smoke (migrations incl. `codex_oauth_sessions`, `/health`, proxy 401, Codex callback redirect). Still thin: authed `/user/*` flows, Codex authorize/callback/proxy, cron tasks.

Current thresholds (`vitest.config.mts`): **statements 20 / branches 15 / functions 12 / lines 22** — scaffold baseline set 2026-09-19 after the gateway rewrite (old thresholds 70/55/70/70 no longer applied; the archive has been removed). Raise plan (stepwise, only when green with headroom): 20/15/12/22 → 50/40/50/50 → 70/55/70/70. Never lower thresholds to make CI pass.

**Covered** (test files exist): `GatewayKeyService` mint/auth/validation (`test/gateway-keys.test.ts`), `ProviderService` create/validation/SSRF guard (`test/providers.test.ts`), `ProviderKeyService` encrypt/hint/validate/decrypt (`test/provider-keys.test.ts`), `RouterService` success-record/429-failover/exhaustion/4xx-passthrough (`test/router-failover.test.ts`), `UpstreamClient` builders/usage parsing/retryable statuses (`test/upstream-client.test.ts`), `UsageService` + `UserService` (`test/usage-user.test.ts`).

**Still thin**: API route handlers (proxy/provider/key/usage), DAO SQL (fake-D1 coverage), cron tasks, `KeyCrypto` round-trip edge cases, SPA components (no component tests by design).

**Mock patterns**:

- Services: stub DAO factories via constructor deps (`{ gatewayKeyDAO: () => Promise.resolve(stub) }`); assert via returned values and event arrays, not `vi.mock`.
- Upstream fetch: inject `fetchImpl` into `RouterService`; script per-key responses by inspecting the `Authorization`/`x-api-key` header.
- Secrets: real `KeyCrypto.encrypt/decrypt` with an ephemeral master key; gateway hashes via real `GatewayKeyService.hashKey`.
- Never trust `Cf-Access-Authenticated-User-Email`; tests use `DEV_AUTH_EMAIL`/`DEMO_MODE` stubs.
