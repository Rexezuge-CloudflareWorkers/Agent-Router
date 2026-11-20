import type { ProviderKeyDAO, ProviderKeyRow } from '@agent-router/backend-data/dao';

/**
Key-health predicates and failure accounting for the failover loop.

Everything that decides whether a key may be tried, and what a failure does to
it, lives here so the Command Code and standard upstream paths cannot drift
into different terminal states for the same failure count.
*/

const MAX_COOLDOWN_EXPONENT = 6;

function isCapExceeded(row: ProviderKeyRow): boolean {
  if (row.token_limit !== null && row.used_tokens >= row.token_limit) return true;
  if (row.request_limit !== null && row.used_requests >= row.request_limit) return true;
  return false;
}

function isOAuthKey(row: ProviderKeyRow): boolean {
  return (row.auth_type ?? 'static') === 'codex_oauth';
}

function isOAuthUsable(row: ProviderKeyRow): boolean {
  return isOAuthKey(row) && row.oauth_status === 'connected' && row.encrypted_refresh_token != null;
}

/**
Exponential backoff: `base * 2^failures`, capped at the seventh failure so a
long streak cannot overflow the cooldown into a multi-day lockout.
*/
function cooldownForFailures(baseMs: number, failures: number): number {
  return baseMs * 2 ** Math.min(failures, MAX_COOLDOWN_EXPONENT);
}

/**
Cooldown to store for a failing key, or `null` once it has crossed the
auto-disable threshold (the caller disables it in the same step).
*/
function cooldownUntilFor(failures: number, now: number, opts: { baseMs: number; disableAfter: number }): number | null {
  return failures >= opts.disableAfter ? null : now + Math.ceil(cooldownForFailures(opts.baseMs, failures) / 1000);
}

/**
Counts one failure against a key, applies exponential cooldown, and disables it
at the threshold. Best-effort: health bookkeeping must never fail a request.
*/
async function recordKeyFailure(
  keyDAO: ProviderKeyDAO,
  candidate: ProviderKeyRow,
  reason: string,
  now: number,
  opts: { baseMs: number; disableAfter: number },
): Promise<void> {
  const failures = candidate.consecutive_failures + 1;
  const cooldownUntil = cooldownUntilFor(failures, now, opts);
  await keyDAO.recordFailure(candidate.id, reason.slice(0, 500), cooldownUntil, now).catch(() => {});
  if (failures >= opts.disableAfter) {
    await keyDAO.disable(candidate.id, now).catch(() => {});
  }
}

export { cooldownForFailures, cooldownUntilFor, isCapExceeded, isOAuthKey, isOAuthUsable, recordKeyFailure };
