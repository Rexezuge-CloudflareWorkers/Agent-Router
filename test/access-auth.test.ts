import { describe, expect, it } from 'vitest';
import { AccessAuthService } from '@agent-router/backend-services/auth';
import { DEMO_USER_EMAIL } from '@agent-router/shared/constants';

/**
Auth is the security boundary: the bypasses must only fire in non-production,
malformed identities must fail closed, and the JWT fallback must reject an
unconfigured deployment rather than let traffic through.
*/

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://router.test/user/me', { headers });
}

describe('AccessAuthService', () => {
  it('honours demo mode only outside production', async () => {
    const dev = new AccessAuthService({ ENVIRONMENT: 'development', DEMO_MODE: 'true' });
    await expect(dev.getAuthenticatedUserEmail(request())).resolves.toBe(DEMO_USER_EMAIL);

    const prod = new AccessAuthService({ ENVIRONMENT: 'production', DEMO_MODE: 'true' });
    await expect(prod.getAuthenticatedUserEmail(request())).rejects.toThrow();
  });

  it('accepts a well-formed dev email only outside production', async () => {
    const dev = new AccessAuthService({ ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'Dev@Example.com' });
    await expect(dev.getAuthenticatedUserEmail(request())).resolves.toBe('dev@example.com');

    const prod = new AccessAuthService({ ENVIRONMENT: 'production', DEV_AUTH_EMAIL: 'dev@example.com' });
    // Falls through to the JWT path, which has no token and no config.
    await expect(prod.getAuthenticatedUserEmail(request())).rejects.toThrow();
  });

  it('rejects a malformed dev email and falls through', async () => {
    const svc = new AccessAuthService({ ENVIRONMENT: 'development', DEV_AUTH_EMAIL: 'not-an-email' });
    await expect(svc.getAuthenticatedUserEmail(request())).rejects.toThrow(/JWT token|verification configuration/i);
  });

  it('throws when no JWT and no configuration is present', async () => {
    const svc = new AccessAuthService({ ENVIRONMENT: 'production' });
    await expect(svc.getAuthenticatedUserEmail(request())).rejects.toThrow(/No Cloudflare Access JWT token/i);
  });

  it('rejects a JWT when the team domain/audience are missing', async () => {
    const svc = new AccessAuthService({ ENVIRONMENT: 'production' });
    await expect(svc.getAuthenticatedUserEmail(request({ 'cf-access-jwt-assertion': 'header.payload.signature' }))).rejects.toThrow(
      /Missing required JWT verification configuration/i,
    );
  });

  it('rejects multi-valued audiences', async () => {
    const svc = new AccessAuthService({ ENVIRONMENT: 'production', TEAM_DOMAIN: 'https://t.example.com', POLICY_AUD: 'a,b' });
    await expect(svc.getAuthenticatedUserEmail(request({ 'cf-access-jwt-assertion': 'header.payload.signature' }))).rejects.toThrow(
      /Multiple JWT audiences/i,
    );
  });

  it('uses the access context identity when the strategy supplies one', async () => {
    const svc = new AccessAuthService({ ENVIRONMENT: 'development' }, [
      // Force only the context strategy by returning null for demo/dev.
      async () => null,
      async (_env, _req, ctx) => {
        const identity = await ctx?.access?.getIdentity?.();
        return identity?.email?.toLowerCase() ?? null;
      },
    ]);
    const ctx = { access: { getIdentity: async () => ({ email: 'Ctx@Example.com' }) } };
    await expect(svc.getAuthenticatedUserEmail(request(), ctx)).resolves.toBe('ctx@example.com');
  });
});
