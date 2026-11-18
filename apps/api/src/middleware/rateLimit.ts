import type { Context, Next } from 'hono';

type RateLimitContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function clientIp(c: RateLimitContext): string {
  // Trust order is deliberate: Cloudflare sets CF-Connecting-IP and it cannot
  // be spoofed by clients; X-Forwarded-For is only a fallback for local dev
  // and non-CF deployments (first entry, trimmed).
  const cfIp = c.req.header('CF-Connecting-IP')?.trim();
  if (cfIp) return cfIp;
  const forwarded = c.req.header('X-Forwarded-For')?.split(',', 1)[0]?.trim();
  return forwarded || 'unknown';
}

function getRateLimitBucketCountForTests(): number {
  return buckets.size;
}

function evictOldestBucket(): void {
  let oldestReset = Infinity;
  for (const [, bucket] of buckets) {
    oldestReset = Math.min(oldestReset, bucket.resetAt);
  }
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt === oldestReset) {
      buckets.delete(key);
      break;
    }
  }
}

function cleanup(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Hard cap so a single isolate cannot grow without bound. Evict oldest
  // resetAt first (LRU-ish) instead of clearing everything, so an attacker
  // flooding new keys cannot wipe out everyone else's buckets.
  let overflow = buckets.size - 5000;
  while (overflow > 0) {
    evictOldestBucket();
    overflow -= 1;
  }
}

/**
Minimal in-memory token-bucket guard for abuse-prone mutating endpoints.
Per-isolate only (Workers have no shared memory); the cron sweeper and DO
single-flight remain the cross-isolate backstop. Never throws — failures
fail open so limiting can never 500 a legitimate request.
*/
function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}): (c: RateLimitContext, next: Next) => Promise<Response | void> {
  return async (c: RateLimitContext, next: Next): Promise<Response | void> => {
    try {
      const now = Date.now();
      cleanup(now);
      let identity = 'anon';
      try {
        identity = c.get('AuthenticatedUserEmailAddress') ?? `ip:${clientIp(c)}`;
      } catch {
        identity = `ip:${clientIp(c)}`;
      }
      const key = `${opts.keyPrefix}:${identity}`;
      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
        await next();
        return;
      }
      if (existing.count >= opts.max) {
        const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
        return c.json({ error: 'Rate limit exceeded; try again later' }, 429, { 'Retry-After': String(retryAfter) });
      }
      existing.count += 1;
      await next();
    } catch {
      await next();
    }
  };
}

function resetRateLimitForTests(): void {
  buckets.clear();
}

export { rateLimit, resetRateLimitForTests, clientIp, getRateLimitBucketCountForTests };
