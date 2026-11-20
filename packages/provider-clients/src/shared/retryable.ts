/**
Retryable upstream status codes.

The standard provider adapters retry on 429/502/503/504. Command Code treats
504 as terminal (its gateway maps 5xx to 502/503 before we see them), so it
keeps a smaller set. Both are named here so the difference is intentional and
greppable rather than three unrelated inline literals.
*/

const STANDARD_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

const COMMAND_CODE_RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503]);

function isRetryableStatus(status: number): boolean {
  return STANDARD_RETRYABLE_STATUSES.has(status);
}

export { COMMAND_CODE_RETRYABLE_STATUSES, STANDARD_RETRYABLE_STATUSES, isRetryableStatus };
