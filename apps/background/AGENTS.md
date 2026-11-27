# Agent-Router — Background Worker

Scope: `apps/background/**`. Parent index: `../../AGENTS.md`.

- `src/index.ts` — re-exports `CronTasksWorker` (also re-exported by `apps/api/src/index.ts` for the DO binding).
- `CronTasksWorker` (`src/CronTasksWorker.ts`) — `POST /run` only (else `404`); single-flight (`202 Already running`); awaits `runScheduledTasks`. Triggered by cron `*/10 * * * *`.
- `src/scheduled/TaskRegistry.ts` — `CRON_TASK_DEFINITIONS: ScheduledTask[]` with `phase: 1 | 2`; `runScheduledTasks` runs phase 1 fully, then phase 2 (each phase `Promise.all`, per-task catch-and-log). Phase 1: `GatewayKeyPruningTask` (expired gateway keys, 500/batch), `UsageResetTask` (monthly `reset_at` rollover), `SearchUsageResetTask` (search key rollover), `CodexTokenRefreshTask` (proactive OAuth refresh via `CodexTokenService.refreshExpiring` + `codex_device_sessions` prune). Phase 2: `KeyHealthTask` (auto-disable keys past `KEY_MAX_CONSECUTIVE_FAILURES`), `SearchKeyHealthTask` (same for search keys), `UsagePruneTask` (`USAGE_RETENTION_DAYS`).
- Composition: resolve per-request state via `createRequestScope(env).get(Tokens.X)`; never `new XDAO(env.DB)` inline.
