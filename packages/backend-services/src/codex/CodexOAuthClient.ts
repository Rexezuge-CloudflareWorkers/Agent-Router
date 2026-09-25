import { OAuth2TokenNonRetryableError, OAuth2TokenRetryableError } from '@agent-router/backend-errors';

// Public PKCE client embedded in the official Codex CLI / IDE extensions.
// No client secret: PKCE S256 proves ownership of the authorization code.
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const CODEX_REVOKE_URL = 'https://auth.openai.com/oauth/revoke';
// Device-code flow (hosted-friendly): the public client is allow-listed for
// localhost callbacks only, so browser redirects cannot work from a gateway.
// These endpoints need no redirect_uri.
const CODEX_DEVICE_USERCODE_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode';
const CODEX_DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token';
const CODEX_DEVICE_VERIFICATION_URL = 'https://auth.openai.com/codex/device';
const CODEX_DEVICE_REDIRECT_URI = 'https://auth.openai.com/deviceauth/callback';
const CODEX_DEVICE_CODE_TTL_MS = 15 * 60 * 1000;

// Workers native fetch is this-sensitive: storing bare `fetch` and calling it
// as `fetchImpl(...)` throws "Illegal invocation" in production, so the
// default keeps the global binding (unicorn/no-unnecessary-global-this
// intentionally suppressed here).
// eslint-disable-next-line unicorn/no-unnecessary-global-this
const defaultFetch: typeof fetch = globalThis.fetch.bind(globalThis);

interface CodexTokenResult {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  expiresIn: number | null;
  accountId: string | null;
}

interface CodexDeviceCode {
  deviceAuthId: string;
  userCode: string;
  pollIntervalSeconds: number;
  expiresAtMs: number;
}

type CodexDevicePoll = { status: 'pending' } | { status: 'authorized'; authorizationCode: string; codeVerifier: string };

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) return null;
  try {
    const normalized = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.codePointAt(i) ?? 0;
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function claimAsString(payload: Record<string, unknown> | null, names: readonly string[]): string | null {
  if (!payload) return null;
  for (const name of names) {
    const value = payload[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function parseAccountId(idToken: string | null, accessToken: string | null): string | null {
  const candidates = ['account_id', 'chatgpt_account_id', 'https://api.openai.com/account_id', 'org_id'] as const;
  const fromId = claimAsString(idToken ? decodeJwtPayload(idToken) : null, candidates);
  if (fromId) return fromId;
  const fromAccess = claimAsString(accessToken ? decodeJwtPayload(accessToken) : null, candidates);
  if (fromAccess) return fromAccess;
  // Namespaced claim used by ChatGPT-issued tokens:
  // {"https://api.openai.com/auth": {"chatgpt_account_id": "..."}}.
  for (const token of [idToken, accessToken]) {
    const payload = token ? decodeJwtPayload(token) : null;
    const namespaced = payload?.['https://api.openai.com/auth'];
    if (!(namespaced && typeof namespaced === 'object') || Array.isArray(namespaced)) {
      continue;
    }
    const accountId = (namespaced as Record<string, unknown>)['chatgpt_account_id'];
    if (typeof accountId === 'string' && accountId.trim()) return accountId.trim();
  }
  return null;
}

function parseExpiresIn(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

interface CodexTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

async function postTokenRequest(values: Record<string, string>, fetchImpl: typeof fetch = defaultFetch): Promise<CodexTokenResponse> {
  let response: Response;
  try {
    response = await fetchImpl(CODEX_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values).toString(),
    });
  } catch (error) {
    throw new OAuth2TokenRetryableError(
      error instanceof Error ? `Codex token request failed: ${error.message}` : 'Codex token request failed',
    );
  }
  let data: CodexTokenResponse;
  try {
    data = (JSON.parse(await response.text()) as CodexTokenResponse) ?? {};
  } catch {
    throw new OAuth2TokenRetryableError(`Codex token request failed with status ${response.status}`);
  }
  if (!response.ok || !data.access_token) {
    const message = `Codex token request failed: ${data.error_description ?? data.error ?? response.statusText}`;
    if (response.status >= 400 && response.status < 500) throw new OAuth2TokenNonRetryableError(message);
    throw new OAuth2TokenRetryableError(message);
  }
  return data;
}

function toTokenResult(data: CodexTokenResponse): CodexTokenResult {
  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null,
    idToken: typeof data.id_token === 'string' && data.id_token ? data.id_token : null,
    expiresIn: parseExpiresIn(data.expires_in),
    accountId: parseAccountId(typeof data.id_token === 'string' ? data.id_token : null, (data.access_token as string) ?? null),
  };
}

async function exchangeCode(
  input: { code: string; codeVerifier: string; redirectUri: string },
  fetchImpl: typeof fetch = defaultFetch,
): Promise<CodexTokenResult> {
  const data = await postTokenRequest(
    {
      grant_type: 'authorization_code',
      client_id: CODEX_CLIENT_ID,
      code: input.code,
      code_verifier: input.codeVerifier,
      redirect_uri: input.redirectUri,
    },
    fetchImpl,
  );
  if (!data.refresh_token) {
    throw new OAuth2TokenNonRetryableError('Codex did not return a refresh token. Reconnect and approve access.');
  }
  return toTokenResult(data);
}

async function refreshAccessToken(input: { refreshToken: string }, fetchImpl: typeof fetch = defaultFetch): Promise<CodexTokenResult> {
  const data = await postTokenRequest(
    {
      grant_type: 'refresh_token',
      client_id: CODEX_CLIENT_ID,
      refresh_token: input.refreshToken,
    },
    fetchImpl,
  );
  // RFC 6749 §6: the server MAY omit a new refresh token; retain the existing one then.
  if (!data.refresh_token) {
    const result = toTokenResult({ ...data, refresh_token: input.refreshToken });
    return result;
  }
  return toTokenResult(data);
}

async function revokeRefreshToken(input: { refreshToken: string }, fetchImpl: typeof fetch = defaultFetch): Promise<void> {
  try {
    await fetchImpl(CODEX_REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: input.refreshToken, token_type_hint: 'refresh_token', client_id: CODEX_CLIENT_ID }).toString(),
    });
  } catch {
    // Best-effort: revocation failure must not block disconnect.
  }
}

interface CodexDeviceUserCodeResponse {
  device_auth_id?: string;
  user_code?: string;
  usercode?: string;
  interval?: string | number;
  expires_at?: string;
}

interface CodexDeviceTokenResponse {
  authorization_code?: string;
  code_verifier?: string;
  code_challenge?: string;
  error?: string;
  error_description?: string;
}

function normalizeInterval(raw: string | number | undefined): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : raw;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : 5;
}

function normalizeExpiryMs(raw: string | undefined): number {
  const parsed = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now() + CODEX_DEVICE_CODE_TTL_MS;
}

async function requestDeviceCode(fetchImpl: typeof fetch = defaultFetch): Promise<CodexDeviceCode> {
  let response: Response;
  try {
    response = await fetchImpl(CODEX_DEVICE_USERCODE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });
  } catch (error) {
    throw new OAuth2TokenRetryableError(
      error instanceof Error ? `Codex device code request failed: ${error.message}` : 'Codex device code request failed',
    );
  }
  let data: CodexDeviceUserCodeResponse;
  try {
    data = (JSON.parse(await response.text()) as CodexDeviceUserCodeResponse) ?? {};
  } catch {
    throw new OAuth2TokenRetryableError(`Codex device code request failed with status ${response.status}`);
  }
  if (!response.ok || !data.device_auth_id || (!data.user_code && !data.usercode)) {
    const message = `Codex device code request failed with status ${response.status}`;
    if (response.status >= 400 && response.status < 500) throw new OAuth2TokenNonRetryableError(message);
    throw new OAuth2TokenRetryableError(message);
  }
  return {
    deviceAuthId: data.device_auth_id,
    userCode: (data.user_code ?? data.usercode) as string,
    pollIntervalSeconds: normalizeInterval(data.interval),
    expiresAtMs: normalizeExpiryMs(data.expires_at),
  };
}

async function pollDeviceCode(
  input: { deviceAuthId: string; userCode: string },
  fetchImpl: typeof fetch = defaultFetch,
): Promise<CodexDevicePoll> {
  let response: Response;
  try {
    response = await fetchImpl(CODEX_DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ device_auth_id: input.deviceAuthId, user_code: input.userCode }),
    });
  } catch (error) {
    throw new OAuth2TokenRetryableError(error instanceof Error ? `Codex device poll failed: ${error.message}` : 'Codex device poll failed');
  }
  // The device endpoint answers 403/404/429 while the user has not approved yet.
  if ([403, 404, 429].includes(response.status)) {
    return { status: 'pending' };
  }
  let data: CodexDeviceTokenResponse;
  try {
    data = (JSON.parse(await response.text()) as CodexDeviceTokenResponse) ?? {};
  } catch {
    throw new OAuth2TokenRetryableError(`Codex device poll failed with status ${response.status}`);
  }
  if (!response.ok) {
    const message = `Codex device authorization failed: ${data.error_description ?? data.error ?? response.statusText}`;
    if (response.status >= 400 && response.status < 500) throw new OAuth2TokenNonRetryableError(message);
    throw new OAuth2TokenRetryableError(message);
  }
  if (!data.authorization_code || !data.code_verifier) {
    // A 200 without a code means approval is still in flight. Keep waiting.
    return { status: 'pending' };
  }
  return { status: 'authorized', authorizationCode: data.authorization_code, codeVerifier: data.code_verifier };
}

export { CodexOAuthClient };
export type { CodexTokenResult, CodexDeviceCode, CodexDevicePoll };

const CodexOAuthClient = {
  clientId: CODEX_CLIENT_ID,
  tokenUrl: CODEX_TOKEN_URL,
  deviceVerificationUrl: CODEX_DEVICE_VERIFICATION_URL,
  deviceRedirectUri: CODEX_DEVICE_REDIRECT_URI,
  exchangeCode,
  refreshAccessToken,
  revokeRefreshToken,
  parseAccountId,
  requestDeviceCode,
  pollDeviceCode,
};
