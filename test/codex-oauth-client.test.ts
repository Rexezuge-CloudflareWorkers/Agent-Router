import { describe, expect, it, vi } from 'vitest';
import { CodexOAuthClient } from '@agent-router/backend-services/codex';
import { OAuth2TokenNonRetryableError, OAuth2TokenRetryableError } from '@rexezuge/errors';

function jwtWithPayload(payload: Record<string, unknown>): string {
  const b64 = (v: string) => Buffer.from(v, 'utf8').toString('base64url');
  return `${b64('{"alg":"RS256"}')}.${b64(JSON.stringify(payload))}.sig`;
}

function tokenFetchImpl(response: { status: number; body: unknown }) {
  return vi.fn(async (..._args: Parameters<typeof fetch>) => Response.json(response.body, { status: response.status }));
}

describe('CodexOAuthClient', () => {
  it('requests device codes and normalizes the response', async () => {
    const fetchImpl = tokenFetchImpl({
      status: 200,
      body: { device_auth_id: 'da-1', usercode: 'WXYZ-9999', interval: 7, expires_at: new Date(Date.now() + 600_000).toISOString() },
    });
    const device = await CodexOAuthClient.requestDeviceCode(fetchImpl as unknown as typeof fetch);
    expect(device.deviceAuthId).toBe('da-1');
    expect(device.userCode).toBe('WXYZ-9999');
    expect(device.pollIntervalSeconds).toBe(7);
    expect(fetchImpl.mock.calls[0]?.[0] as unknown as string).toContain('/deviceauth/usercode');
    await expect(CodexOAuthClient.requestDeviceCode(tokenFetchImpl({ status: 200, body: {} }) as unknown as typeof fetch)).rejects.toThrow(
      /device code/i,
    );
    await expect(
      CodexOAuthClient.requestDeviceCode(tokenFetchImpl({ status: 400, body: { error: 'x' } }) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(OAuth2TokenNonRetryableError);
  });

  it('polls device approval with pending/authorized mapping', async () => {
    const input = { deviceAuthId: 'da-1', userCode: 'WXYZ-9999' };
    for (const status of [403, 404, 429]) {
      const pending = await CodexOAuthClient.pollDeviceCode(input, tokenFetchImpl({ status, body: {} }) as unknown as typeof fetch);
      expect(pending).toEqual({ status: 'pending' });
    }
    const noCode = await CodexOAuthClient.pollDeviceCode(input, tokenFetchImpl({ status: 200, body: {} }) as unknown as typeof fetch);
    expect(noCode).toEqual({ status: 'pending' });
    const authorized = await CodexOAuthClient.pollDeviceCode(
      input,
      tokenFetchImpl({
        status: 200,
        body: { authorization_code: 'ac', code_verifier: 'cv', code_challenge: 'cc' },
      }) as unknown as typeof fetch,
    );
    expect(authorized).toEqual({ status: 'authorized', authorizationCode: 'ac', codeVerifier: 'cv' });
    await expect(
      CodexOAuthClient.pollDeviceCode(input, tokenFetchImpl({ status: 400, body: { error: 'expired_token' } }) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(OAuth2TokenNonRetryableError);
    await expect(
      CodexOAuthClient.pollDeviceCode(input, tokenFetchImpl({ status: 500, body: {} }) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(OAuth2TokenRetryableError);
  });

  it('extracts the ChatGPT account id from id or access tokens', () => {
    const id = jwtWithPayload({ account_id: 'acc-1' });
    expect(CodexOAuthClient.parseAccountId(id, null)).toBe('acc-1');
    const access = jwtWithPayload({ 'https://api.openai.com/account_id': 'acc-2' });
    expect(CodexOAuthClient.parseAccountId(null, access)).toBe('acc-2');
    const namespaced = jwtWithPayload({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acc-3' } });
    expect(CodexOAuthClient.parseAccountId(namespaced, null)).toBe('acc-3');
    expect(CodexOAuthClient.parseAccountId(null, null)).toBeNull();
    expect(CodexOAuthClient.parseAccountId('not-a-jwt', 'also-not')).toBeNull();
  });

  it('exchanges codes and requires a refresh token', async () => {
    const id = jwtWithPayload({ account_id: 'acc-9' });
    const fetchImpl = tokenFetchImpl({ status: 200, body: { access_token: 'at', refresh_token: 'rt', id_token: id, expires_in: 3600 } });
    const result = await CodexOAuthClient.exchangeCode(
      { code: 'code', codeVerifier: 'verifier', redirectUri: 'https://gw/cb' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.accessToken).toBe('at');
    expect(result.refreshToken).toBe('rt');
    expect(result.accountId).toBe('acc-9');
    await expect(
      CodexOAuthClient.exchangeCode(
        { code: 'code', codeVerifier: 'v', redirectUri: 'https://gw/cb' },
        tokenFetchImpl({ status: 200, body: { access_token: 'at' } }) as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/refresh token/i);
  });

  it('retains the existing refresh token when rotation omits a new one', async () => {
    const result = await CodexOAuthClient.refreshAccessToken(
      { refreshToken: 'rt-old' },
      tokenFetchImpl({ status: 200, body: { access_token: 'at-new', expires_in: 100 } }) as unknown as typeof fetch,
    );
    expect(result.accessToken).toBe('at-new');
    expect(result.refreshToken).toBe('rt-old');
  });

  it('classifies 4xx as non-retryable and 5xx as retryable', async () => {
    await expect(
      CodexOAuthClient.refreshAccessToken(
        { refreshToken: 'rt' },
        tokenFetchImpl({ status: 400, body: { error: 'invalid_grant' } }) as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(OAuth2TokenNonRetryableError);
    await expect(
      CodexOAuthClient.refreshAccessToken({ refreshToken: 'rt' }, tokenFetchImpl({ status: 503, body: {} }) as unknown as typeof fetch),
    ).rejects.toBeInstanceOf(OAuth2TokenRetryableError);
  });
});
