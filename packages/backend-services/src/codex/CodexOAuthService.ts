import { CodexDeviceSessionDAO, ProviderDAO, ProviderKeyDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@agent-router/backend-data/utils';
import { BadRequestError, NotFoundError, OAuth2TokenNonRetryableError, OAuth2TokenRetryableError } from '@agent-router/backend-errors';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import type { ProviderKeyMetadata } from '@agent-router/shared';
import { TimestampUtil, UUIDUtil } from '@agent-router/shared/utils';
import { KeyCrypto } from '../provider/KeyCrypto';
import { CodexOAuthClient } from './CodexOAuthClient';

interface CodexOAuthServiceEnv {
  DB: D1Queryable;
  CODEX_OAUTH_ENCRYPTION_SECRET?: { get(): Promise<string> };
}

interface CodexOAuthServiceDeps {
  providerDAO?: () => Promise<ProviderDAO>;
  providerKeyDAO?: () => Promise<ProviderKeyDAO>;
  deviceSessionDAO?: () => Promise<CodexDeviceSessionDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
  fetchImpl?: typeof fetch;
}

interface CodexDeviceStart {
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  pollIntervalSeconds: number;
}

type CodexDeviceStatus =
  | { status: 'pending'; expiresAt: number; pollIntervalSeconds: number }
  | { status: 'connected'; accountId: string | null }
  | { status: 'expired' }
  | { status: 'failed'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
Extracts a refresh token from pasted credentials.

Accepts a bare token string or a JSON blob in any of the shapes written by
the Codex app (`~/.codex/auth.json`: `{tokens: {refresh_token}}`) and
OpenCode's Codex plugin (`{refresh}` / `{refresh_token}`).
*/
function extractRefreshToken(input: { refreshToken?: unknown; authJson?: unknown }): string | null {
  const fromValue = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (trimmed.startsWith('{')) {
        try {
          return fromValue(JSON.parse(trimmed) as unknown);
        } catch {
          return null;
        }
      }
      return trimmed;
    }
    if (!isRecord(value)) return null;
    for (const key of ['refresh_token', 'refresh']) {
      const direct = fromValue(value[key]);
      if (direct) return direct;
    }
    for (const key of ['tokens', 'credentials', 'auth']) {
      const nested = fromValue(value[key]);
      if (nested) return nested;
    }
    return null;
  };
  return fromValue(input.refreshToken) ?? fromValue(input.authJson);
}

/**
Extracts a ChatGPT account id from pasted credentials when present.

Same nested shapes as extractRefreshToken (`tokens`/`credentials`/`auth`
wrappers, `account_id`/`chatgpt_account_id` keys). Used as a backfill when
the refreshed token's JWT carries no account claims — without an account
id the gateway omits `ChatGPT-Account-Id` and the Codex backend answers
with its login page instead of reaching the model. Bare token strings are
never treated as account ids.
*/
function toAccountObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return isRecord(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function searchAccountObject(obj: Record<string, unknown> | null): string | null {
  if (!obj) return null;
  for (const key of ['account_id', 'chatgpt_account_id']) {
    const direct = obj[key];
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
  }
  for (const key of ['tokens', 'credentials', 'auth']) {
    const nested = searchAccountObject(toAccountObject(obj[key]));
    if (nested) return nested;
  }
  return null;
}

function extractAccountId(input: { refreshToken?: unknown; authJson?: unknown }): string | null {
  return searchAccountObject(toAccountObject(input.refreshToken)) ?? searchAccountObject(toAccountObject(input.authJson));
}

class CodexOAuthService {
  private readonly deps: Required<CodexOAuthServiceDeps>;

  constructor(
    private readonly env: CodexOAuthServiceEnv,
    deps: CodexOAuthServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    const masterKey =
      deps.masterKey ??
      (async () => {
        if (!env.CODEX_OAUTH_ENCRYPTION_SECRET) throw new BadRequestError('Codex OAuth encryption is not configured');
        return env.CODEX_OAUTH_ENCRYPTION_SECRET.get();
      });
    this.deps = {
      providerDAO: () => Promise.resolve(new ProviderDAO(env.DB)),
      providerKeyDAO: () => Promise.resolve(new ProviderKeyDAO(env.DB)),
      deviceSessionDAO: () => Promise.resolve(new CodexDeviceSessionDAO(env.DB)),
      masterKey,
      config,
      // Bound fetch: Workers native fetch is this-sensitive (see CodexOAuthClient).
      // eslint-disable-next-line unicorn/no-unnecessary-global-this
      fetchImpl: deps.fetchImpl ?? globalThis.fetch.bind(globalThis),
      ...deps,
    };
  }

  private async requireCodexKey(providerId: string, keyId: string, userEmail: string) {
    const providerDAO = await this.deps.providerDAO();
    const provider = await providerDAO.getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    if (provider.kind !== 'OPENAI_CODEX') throw new BadRequestError('Provider is not an OpenAI Codex provider');
    const keyDAO = await this.deps.providerKeyDAO();
    const key = await keyDAO.getById(keyId);
    if (!key || key.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    if ((key.auth_type ?? 'static') !== 'codex_oauth') throw new BadRequestError('Key is not a Codex OAuth key');
    return { provider, key, keyDAO };
  }

  public async createAuthorizationKey(
    providerId: string,
    userEmail: string,
    input: { name?: unknown; priority?: unknown },
  ): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    const providerDAO = await this.deps.providerDAO();
    const provider = await providerDAO.getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== normalized) throw new NotFoundError('Provider not found');
    if (provider.kind !== 'OPENAI_CODEX') throw new BadRequestError('Provider is not an OpenAI Codex provider');
    const name = typeof input.name === 'string' ? input.name.trim() : 'Codex OAuth';
    if (!name) throw new BadRequestError('name is required');
    if (name.length > 80) throw new BadRequestError('name must be at most 80 characters');
    let priority = 0;
    if (input.priority !== undefined && input.priority !== null) {
      const n = typeof input.priority === 'string' ? Number(input.priority.trim()) : (input.priority as number);
      if (!Number.isSafeInteger(n) || n < 0 || n > 1000) throw new BadRequestError('priority must be an integer 0-1000');
      priority = n;
    }
    const keyDAO = await this.deps.providerKeyDAO();
    const max = this.deps.config.getMaxKeysPerProvider();
    if ((await keyDAO.countByProvider(providerId)) >= max) throw new BadRequestError(`Maximum ${max} keys per provider`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await keyDAO.createOAuthKey({ id, providerId, userEmail: normalized, name, priority, now });
    const created = await keyDAO.getMetadataById(id);
    if (!created) throw new NotFoundError('Provider key not found');
    return created;
  }

  /**
  Starts a device-code authorization for a Codex key.
  
  Returns the short code the user enters at the verification URL.
  The browser never touches this flow, so no redirect_uri is involved.
  */
  public async startDeviceAuthorization(providerId: string, keyId: string, userEmail: string): Promise<CodexDeviceStart> {
    const normalized = userEmail.toLowerCase();
    await this.requireCodexKey(providerId, keyId, normalized);
    const device = await CodexOAuthClient.requestDeviceCode(this.deps.fetchImpl);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const expiresAt = Math.floor(device.expiresAtMs / 1000);
    const sessionDAO = await this.deps.deviceSessionDAO();
    await sessionDAO.deleteByKey(keyId).catch(() => undefined);
    await sessionDAO.create({
      deviceAuthId: device.deviceAuthId,
      providerKeyId: keyId,
      userEmail: normalized,
      userCode: device.userCode,
      verificationUrl: CodexOAuthClient.deviceVerificationUrl,
      pollIntervalSeconds: device.pollIntervalSeconds,
      now,
      expiresAt,
    });
    return {
      userCode: device.userCode,
      verificationUrl: CodexOAuthClient.deviceVerificationUrl,
      expiresAt,
      pollIntervalSeconds: device.pollIntervalSeconds,
    };
  }

  /**
  Performs a single device-authorization poll.
  
  Transient upstream failures stay `pending` so the frontend keeps polling;
  only approval, expiry, or a terminal error ends the flow.
  */
  public async pollDeviceAuthorization(providerId: string, keyId: string, userEmail: string): Promise<CodexDeviceStatus> {
    const normalized = userEmail.toLowerCase();
    const { keyDAO } = await this.requireCodexKey(providerId, keyId, normalized);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const sessionDAO = await this.deps.deviceSessionDAO();
    const session = await sessionDAO.getActiveByKey(keyId, now);
    if (!session) return { status: 'expired' };
    const pending = { status: 'pending' as const, expiresAt: session.expiresAt, pollIntervalSeconds: session.pollIntervalSeconds };
    let poll: Awaited<ReturnType<typeof CodexOAuthClient.pollDeviceCode>>;
    try {
      poll = await CodexOAuthClient.pollDeviceCode({ deviceAuthId: session.deviceAuthId, userCode: session.userCode }, this.deps.fetchImpl);
    } catch (error) {
      if (error instanceof OAuth2TokenRetryableError) return pending;
      await sessionDAO.consume(session.deviceAuthId, now).catch(() => undefined);
      return { status: 'failed', message: error instanceof Error ? error.message : 'Codex authorization failed.' };
    }
    if (poll.status === 'pending') return pending;
    try {
      const tokens = await CodexOAuthClient.exchangeCode(
        { code: poll.authorizationCode, codeVerifier: poll.codeVerifier, redirectUri: CodexOAuthClient.deviceRedirectUri },
        this.deps.fetchImpl,
      );
      const masterKey = await this.deps.masterKey();
      const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
        KeyCrypto.encrypt(tokens.accessToken, masterKey, 'codex-oauth'),
        KeyCrypto.encrypt(tokens.refreshToken as string, masterKey, 'codex-oauth'),
      ]);
      const accessExpiresAt = now + (tokens.expiresIn ?? 864_000);
      await keyDAO.updateOAuthConnected(keyId, {
        encryptedAccessToken,
        encryptedRefreshToken,
        accountId: tokens.accountId,
        accessExpiresAt,
        now,
      });
    } catch (error) {
      if (error instanceof OAuth2TokenRetryableError) return pending;
      await sessionDAO.consume(session.deviceAuthId, now).catch(() => undefined);
      return { status: 'failed', message: error instanceof Error ? error.message : 'Codex authorization failed.' };
    }
    await sessionDAO.consume(session.deviceAuthId, now).catch(() => undefined);
    const updated = await keyDAO.getMetadataById(keyId);
    return { status: 'connected', accountId: updated?.codexAccountId ?? null };
  }

  /**
  Imports a refresh token pasted from the Codex app or OpenCode.
  
  The token is validated with an immediate refresh (which also yields the
  account id), then stored encrypted like a device-flow connection.
  */
  public async importRefreshToken(
    providerId: string,
    keyId: string,
    userEmail: string,
    input: { refreshToken?: unknown; authJson?: unknown },
  ): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    const { keyDAO } = await this.requireCodexKey(providerId, keyId, normalized);
    const pasted = extractRefreshToken(input);
    if (!pasted) throw new BadRequestError('No refresh token found. Paste the token or the full auth JSON.');
    let refreshed: Awaited<ReturnType<typeof CodexOAuthClient.refreshAccessToken>>;
    try {
      refreshed = await CodexOAuthClient.refreshAccessToken({ refreshToken: pasted }, this.deps.fetchImpl);
    } catch (error) {
      if (error instanceof OAuth2TokenNonRetryableError) {
        throw new BadRequestError('The pasted token was rejected. Sign in again and paste a fresh token.');
      }
      throw error;
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const masterKey = await this.deps.masterKey();
    const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
      KeyCrypto.encrypt(refreshed.accessToken, masterKey, 'codex-oauth'),
      KeyCrypto.encrypt(refreshed.refreshToken ?? pasted, masterKey, 'codex-oauth'),
    ]);
    await keyDAO.updateOAuthConnected(keyId, {
      encryptedAccessToken,
      encryptedRefreshToken,
      accountId: refreshed.accountId ?? extractAccountId(input),
      accessExpiresAt: now + (refreshed.expiresIn ?? 864_000),
      now,
    });
    const sessionDAO = await this.deps.deviceSessionDAO();
    await sessionDAO.deleteByKey(keyId).catch(() => undefined);
    const updated = await keyDAO.getMetadataById(keyId);
    if (!updated) throw new NotFoundError('Provider key not found');
    return updated;
  }

  public async disconnect(providerId: string, keyId: string, userEmail: string): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    const { keyDAO } = await this.requireCodexKey(providerId, keyId, normalized);
    const key = await keyDAO.getById(keyId);
    if (key?.encrypted_refresh_token) {
      try {
        const masterKey = await this.deps.masterKey();
        const refreshToken = await KeyCrypto.decrypt(key.encrypted_refresh_token, masterKey, 'codex-oauth');
        await CodexOAuthClient.revokeRefreshToken({ refreshToken }, this.deps.fetchImpl);
      } catch {
        // Best-effort revocation; local state is cleared regardless.
      }
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await keyDAO.clearOAuth(keyId, now);
    const sessionDAO = await this.deps.deviceSessionDAO();
    await sessionDAO.deleteByKey(keyId).catch(() => undefined);
    const updated = await keyDAO.getMetadataById(keyId);
    if (!updated) throw new NotFoundError('Provider key not found');
    return updated;
  }

  public async getStatus(providerId: string, keyId: string, userEmail: string): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    const { keyDAO } = await this.requireCodexKey(providerId, keyId, normalized);
    const meta = await keyDAO.getMetadataById(keyId);
    if (!meta) throw new NotFoundError('Provider key not found');
    return meta;
  }
}

export { CodexOAuthService };
export type { CodexOAuthServiceDeps, CodexOAuthServiceEnv, CodexDeviceStart, CodexDeviceStatus };
