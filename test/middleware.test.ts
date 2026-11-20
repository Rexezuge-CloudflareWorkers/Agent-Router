import { describe, expect, it, beforeEach } from 'vitest';
import { rateLimit, resetRateLimitForTests, getRateLimitBucketCountForTests } from '@/middleware/rateLimit';
import { isSensitiveJsonPath } from '@/middleware/securityHeaders';

/**
Middleware guards: the limiter must 429 past the window and fail open on
internal errors, and the cache-control predicate must match secret paths by
exact prefix (not substring).
*/

function ctx(email?: string) {
  const ip = '203.0.113.7';
  const store = new Map<string, unknown>();
  return {
    store,
    req: { header: (name: string) => (name.toLowerCase() === 'cf-connecting-ip' ? ip : undefined) },
    get: (key: string) => (key === 'AuthenticatedUserEmailAddress' ? email : store.get(key)),
    set: (key: string, value: unknown) => store.set(key, value),
    json: (body: unknown, status: number, headers?: Record<string, string>) => Response.json(body, { status, headers }),
  };
}

describe('rateLimit', () => {
  beforeEach(() => resetRateLimitForTests());

  it('allows up to the limit then returns 429 with Retry-After', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 't' });
    let calls = 0;
    const next = async () => {
      calls += 1;
    };
    const c = ctx('u@x.y');
    await limiter(c as never, next);
    await limiter(c as never, next);
    const third = await limiter(c as never, next);
    expect(calls).toBe(2);
    expect(third).toBeInstanceOf(Response);
    expect((third as Response).status).toBe(429);
    expect((third as Response).headers.get('Retry-After')).toBeTruthy();
  });

  it('keys buckets by authenticated email when present', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 't' });
    const next = async () => {};
    await limiter(ctx('a@x.y') as never, next);
    // Same IP, different email → separate bucket.
    await limiter(ctx('b@x.y') as never, next);
    expect(getRateLimitBucketCountForTests()).toBe(2);
  });

  it('fails open when the handler throws internally', async () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, keyPrefix: 't' });
    const broken = {
      ...ctx(),
      get: () => {
        throw new Error('boom');
      },
      req: {
        header: () => {
          throw new Error('boom');
        },
      },
    };
    let reached = false;
    const response = await limiter(broken as never, async () => {
      reached = true;
    });
    // clientIp swallows via optional-chain-ish access in the limiter, so the
    // request still proceeds.
    expect(response).toBeUndefined();
    expect(reached).toBe(true);
  });
});

describe('isSensitiveJsonPath', () => {
  it('matches secret routes by exact prefix only', () => {
    expect(isSensitiveJsonPath('/user/gateway-keys')).toBe(true);
    expect(isSensitiveJsonPath('/user/gateway-keys/abc')).toBe(true);
    expect(isSensitiveJsonPath('/user/providers')).toBe(true);
    expect(isSensitiveJsonPath('/user/providers/p1/keys')).toBe(true);
    // A path that merely contains the substring must not match.
    expect(isSensitiveJsonPath('/hooks/providers/x')).toBe(false);
    expect(isSensitiveJsonPath('/user/usage/summary')).toBe(false);
  });
});
