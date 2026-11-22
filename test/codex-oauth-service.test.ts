import { describe, expect, it, vi } from 'vitest';
import { CodexOAuthService } from '@agent-router/backend-services/codex';
import { KeyCrypto } from '@agent-router/backend-services/provider';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

const MASTER = 'test-master-key';

function b64(v: string): string {
  return Buffer.from(v, 'utf8').toString('base64url');
}

function jwtWithPayload(payload: Record<string, unknown>): string {
  return `${b64('{"alg":"RS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    provider_id: 'p1',
    user_email: 'u@x.y',
    name: 'Codex',
    encrypted_key: '',
    key_hint: null,
    token_limit: null,
    request_limit: null,
    used_tokens: 0,
    used_requests: 0,
    reset_at: null,
    priority: 0,
    status: 'active',
    cooldown_until: null,
    consecutive_failures: 0,
    last_used_at: null,
    last_error: null,
    created_at: 1,
    updated_at: null,
    auth_type: 'codex_oauth',
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    codex_account_id: null,
    access_expires_at: null,
    oauth_status: 'pending',
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
Routes stub fetch calls to device usercode / device token / oauth token URLs.
*/
function deviceFetchStub(
  opts: {
    usercode?: Error | { status: number; body: unknown };
    deviceToken?: Error | { status: number; body: unknown };
    oauthToken?: Error | { status: number; body: unknown };
    revoke?: { status: number; body: unknown };
  } = {},
) {
  return vi.fn(async (url: unknown) => {
    const defaultFallback = { status: 403, body: {} };
    const target = String(url);
    const pick = ({
      entry,
      fallback = defaultFallback,
    }: { entry?: Error | { status: number; body: unknown }; fallback?: { status: number; body: unknown } } = {}) => {
      const chosen = entry ?? fallback;
      if (chosen instanceof Error) throw chosen;
      return jsonResponse(chosen.body, chosen.status);
    };
    if (target.includes('/deviceauth/usercode')) {
      return pick({
        entry: opts.usercode,
        fallback: {
          status: 200,
          body: { device_auth_id: 'da-1', user_code: 'ABCD-1234', interval: '5', expires_at: new Date(Date.now() + 900_000).toISOString() },
        },
      });
    }
    if (target.includes('/deviceauth/token')) return pick({ entry: opts.deviceToken });
    if (target.includes('/oauth/token')) {
      return pick({
        entry: opts.oauthToken,
        fallback: {
          status: 200,
          body: { access_token: 'at-1', refresh_token: 'rt-1', id_token: jwtWithPayload({ account_id: 'acc-9' }), expires_in: 3600 },
        },
      });
    }
    if (target.includes('/oauth/revoke')) {
      const rev = opts.revoke ?? { status: 200, body: {} };
      return jsonResponse(rev.body, rev.status);
    }
    return jsonResponse({}, 404);
  });
}

function makeService(
  opts: {
    providerKind?: string;
    key?: Record<string, unknown> | null;
    deviceSession?: Record<string, unknown> | null | 'missing';
    fetchImpl?: typeof fetch;
  } = {},
) {
  const calls: Record<string, unknown[]> = {
    createOAuthKey: [],
    deviceSessions: [],
    deviceDeleted: [],
    deviceConsumed: [],
    connected: [],
    cleared: [],
  };
  const providerDAO = {
    getById: async () => ({
      id: 'p1',
      userEmail: 'u@x.y',
      kind: opts.providerKind ?? 'OPENAI_CODEX',
      name: 'Codex',
      baseUrl: 'https://api.openai.com/v1',
      status: 'active',
      createdAt: 1,
      updatedAt: null,
    }),
  };
  const keyRow = opts.key === undefined ? row() : opts.key;
  const providerKeyDAO = {
    countByProvider: async () => 0,
    getById: async () => keyRow,
    getMetadataById: async () =>
      keyRow
        ? {
            id: 'k1',
            providerId: 'p1',
            userEmail: 'u@x.y',
            authType: 'codex_oauth',
            oauthStatus: 'connected',
            codexAccountId: 'acc-9',
          }
        : null,
    createOAuthKey: async (r: unknown) => void calls.createOAuthKey.push(r),
    updateOAuthConnected: async (id: string, patch: unknown) => void calls.connected.push({ id, patch }),
    clearOAuth: async (id: string) => void calls.cleared.push(id),
  };
  const session =
    opts.deviceSession === undefined
      ? {
          deviceAuthId: 'da-1',
          providerKeyId: 'k1',
          userEmail: 'u@x.y',
          userCode: 'ABCD-1234',
          verificationUrl: 'https://auth.openai.com/codex/device',
          pollIntervalSeconds: 5,
          createdAt: 1,
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          consumedAt: null,
        }
      : opts.deviceSession === 'missing'
        ? null
        : opts.deviceSession;
  const deviceSessionDAO = {
    create: async (r: unknown) => void calls.deviceSessions.push(r),
    getActiveByKey: async () => session,
    consume: async (id: string) => void calls.deviceConsumed.push(id),
    deleteByKey: async (id: string) => void calls.deviceDeleted.push(id),
    deleteExpiredOrConsumed: async () => 0,
  };
  const env = { DB: {} as never };
  const svc = new CodexOAuthService(env, {
    providerDAO: () => Promise.resolve(providerDAO as never),
    providerKeyDAO: () => Promise.resolve(providerKeyDAO as never),
    deviceSessionDAO: () => Promise.resolve(deviceSessionDAO as never),
    masterKey: async () => MASTER,
    config: AppConfiguration.fromEnv(env),
    fetchImpl: opts.fetchImpl,
  });
  return { svc, calls, deviceSessionDAO };
}

describe('CodexOAuthService device flow', () => {
  it('creates pending OAuth keys only for OPENAI_CODEX providers', async () => {
    const { svc, calls } = makeService();
    const created = await svc.createAuthorizationKey('p1', 'U@X.Y', { name: 'My Codex' });
    expect(created.id).toBe('k1');
    expect(calls.createOAuthKey).toHaveLength(1);
    const wrong = makeService({ providerKind: 'OPENAI' });
    await expect(wrong.svc.createAuthorizationKey('p1', 'u@x.y', { name: 'x' })).rejects.toThrow(/Codex/i);
  });

  it('starts a device authorization and stores the session', async () => {
    const fetchImpl = deviceFetchStub();
    const { svc, calls } = makeService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const started = await svc.startDeviceAuthorization('p1', 'k1', 'u@x.y');
    expect(started.userCode).toBe('ABCD-1234');
    expect(started.verificationUrl).toContain('auth.openai.com');
    expect(started.pollIntervalSeconds).toBe(5);
    expect(started.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(calls.deviceDeleted).toEqual(['k1']);
    expect(calls.deviceSessions).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalled();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/deviceauth/usercode');
  });

  it('returns pending while the user has not approved', async () => {
    const fetchImpl = deviceFetchStub({ deviceToken: { status: 403, body: {} } });
    const { svc, calls } = makeService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const status = await svc.pollDeviceAuthorization('p1', 'k1', 'u@x.y');
    expect(status.status).toBe('pending');
    expect(calls.connected).toHaveLength(0);
    expect(calls.deviceConsumed).toHaveLength(0);
  });

  it('completes an approved device code with encrypted tokens', async () => {
    const fetchImpl = deviceFetchStub({
      deviceToken: { status: 200, body: { authorization_code: 'auth-code', code_verifier: 'verifier', code_challenge: 'c' } },
    });
    const { svc, calls } = makeService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const status = await svc.pollDeviceAuthorization('p1', 'k1', 'u@x.y');
    expect(status).toEqual({ status: 'connected', accountId: 'acc-9' });
    expect(calls.deviceConsumed).toEqual(['da-1']);
    const patch = (calls.connected[0] as { patch: { encryptedAccessToken: string; encryptedRefreshToken: string } }).patch;
    expect(await KeyCrypto.decrypt(patch.encryptedAccessToken, MASTER, 'codex-oauth')).toBe('at-1');
    expect(await KeyCrypto.decrypt(patch.encryptedRefreshToken, MASTER, 'codex-oauth')).toBe('rt-1');
  });

  it('stays pending on transient poll failures and expires without a session', async () => {
    const failing = deviceFetchStub({ deviceToken: new Error('boom') });
    const { svc, calls } = makeService({ fetchImpl: failing as unknown as typeof fetch });
    const pending = await svc.pollDeviceAuthorization('p1', 'k1', 'u@x.y');
    expect(pending.status).toBe('pending');
    expect(calls.deviceConsumed).toHaveLength(0);

    const denied = deviceFetchStub({ deviceToken: { status: 400, body: { error: 'expired_token' } } });
    const { svc: deniedSvc, calls: deniedCalls } = makeService({ fetchImpl: denied as unknown as typeof fetch });
    const failed = await deniedSvc.pollDeviceAuthorization('p1', 'k1', 'u@x.y');
    expect(failed.status).toBe('failed');
    expect(deniedCalls.deviceConsumed).toEqual(['da-1']);

    const { svc: noSession } = makeService({ deviceSession: 'missing' });
    await expect(noSession.pollDeviceAuthorization('p1', 'k1', 'u@x.y')).resolves.toEqual({ status: 'expired' });
  });
});

describe('CodexOAuthService refresh-token import', () => {
  it('imports a bare refresh token from the Codex app', async () => {
    const fetchImpl = deviceFetchStub();
    const { svc, calls } = makeService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const updated = await svc.importRefreshToken('p1', 'k1', 'u@x.y', { refreshToken: 'rt-pasted' });
    expect(updated.id).toBe('k1');
    expect(calls.connected).toHaveLength(1);
    const patch = (calls.connected[0] as { patch: { encryptedAccessToken: string; encryptedRefreshToken: string } }).patch;
    expect(await KeyCrypto.decrypt(patch.encryptedAccessToken, MASTER, 'codex-oauth')).toBe('at-1');
    expect(await KeyCrypto.decrypt(patch.encryptedRefreshToken, MASTER, 'codex-oauth')).toBe('rt-1');
    expect(calls.deviceDeleted).toEqual(['k1']);
  });

  it('extracts tokens from Codex app and OpenCode auth JSON shapes', async () => {
    const fetchImpl = deviceFetchStub();
    const { svc, calls } = makeService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const codexAppJson = JSON.stringify({
      OPENAI_API_KEY: 'sk-x',
      tokens: { id_token: 'i', access_token: 'a', refresh_token: 'rt-codex-app' },
    });
    await svc.importRefreshToken('p1', 'k1', 'u@x.y', { authJson: codexAppJson });
    const openCodeJson = JSON.stringify({ type: 'oauth', refresh: 'rt-opencode', access: 'a', expires: 1 });
    await svc.importRefreshToken('p1', 'k1', 'u@x.y', { authJson: openCodeJson });
    expect(calls.connected).toHaveLength(2);
    await expect(svc.importRefreshToken('p1', 'k1', 'u@x.y', { authJson: '{"nope": true}' })).rejects.toThrow(/No refresh token/i);
    await expect(svc.importRefreshToken('p1', 'k1', 'u@x.y', {})).rejects.toThrow(/No refresh token/i);
  });

  it('backfills the account id from pasted auth JSON when refresh yields none', async () => {
    const noAccount = deviceFetchStub({
      oauthToken: { status: 200, body: { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 } },
    });
    const { svc, calls } = makeService({ fetchImpl: noAccount as unknown as typeof fetch });
    const withAccount = JSON.stringify({ tokens: { refresh_token: 'rt-x', account_id: 'acc-pasted' } });
    await svc.importRefreshToken('p1', 'k1', 'u@x.y', { authJson: withAccount });
    // A bare token string must never be mistaken for an account id.
    await svc.importRefreshToken('p1', 'k1', 'u@x.y', { refreshToken: 'rt-bare' });
    expect((calls.connected[0] as { patch: { accountId: string | null } }).patch.accountId).toBe('acc-pasted');
    expect((calls.connected[1] as { patch: { accountId: string | null } }).patch.accountId).toBeNull();
  });

  it('rejects pasted tokens that OpenAI refuses', async () => {
    const fetchImpl = deviceFetchStub({ oauthToken: { status: 400, body: { error: 'invalid_grant' } } });
    const { svc, calls } = makeService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(svc.importRefreshToken('p1', 'k1', 'u@x.y', { refreshToken: 'rt-dead' })).rejects.toThrow(/rejected/i);
    expect(calls.connected).toHaveLength(0);
  });

  it('disconnect clears tokens and device sessions with revocation', async () => {
    const revokeFetch = deviceFetchStub();
    const withRefresh = makeService({
      key: row({ oauth_status: 'connected', encrypted_refresh_token: await KeyCrypto.encrypt('rt-live', MASTER, 'codex-oauth') }),
      fetchImpl: revokeFetch as unknown as typeof fetch,
    });
    await withRefresh.svc.disconnect('p1', 'k1', 'u@x.y');
    expect(String(revokeFetch.mock.calls[0]?.[0])).toContain('auth.openai.com/oauth/revoke');
    expect(withRefresh.calls.cleared).toEqual(['k1']);
    expect(withRefresh.calls.deviceDeleted).toEqual(['k1']);
  });
});
