import { ProviderKeyDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError, OAuth2TokenNonRetryableError } from '@rexezuge/errors';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { TimestampUtil } from '@rexezuge/shared';
import { KeyCrypto } from '../provider/KeyCrypto';
import { CodexOAuthClient } from '@agent-router/provider-clients/codex';

interface CodexTokenServiceEnv {
  DB: D1Queryable;
  CODEX_ACCESS_MIN_VALID_SECONDS?: string;
  CODEX_OAUTH_ENCRYPTION_SECRET?: { get(): Promise<string> };
}

interface CodexTokenServiceDeps {
  providerKeyDAO?: () => Promise<ProviderKeyDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
  fetchImpl?: typeof fetch;
}

interface CodexAccessToken {
  accessToken: string;
  accountId: string | null;
  expiresAt: number;
}

const FALLBACK_ACCESS_TTL_SECONDS = 864_000;

class CodexTokenService {
  private readonly deps: Required<CodexTokenServiceDeps>;
  private readonly inFlight = new Map<string, Promise<CodexAccessToken>>();

  constructor(
    private readonly env: CodexTokenServiceEnv,
    deps: CodexTokenServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    const masterKey =
      deps.masterKey ??
      (async () => {
        if (!env.CODEX_OAUTH_ENCRYPTION_SECRET) throw new BadRequestError('Codex OAuth encryption is not configured');
        return env.CODEX_OAUTH_ENCRYPTION_SECRET.get();
      });
    this.deps = {
      providerKeyDAO: () => Promise.resolve(new ProviderKeyDAO(env.DB)),
      masterKey,
      config,
      // Bound fetch: Workers native fetch is this-sensitive (see CodexOAuthClient).
      // eslint-disable-next-line unicorn/no-unnecessary-global-this
      fetchImpl: deps.fetchImpl ?? globalThis.fetch.bind(globalThis),
      ...deps,
    };
  }

  public async getAccessToken(
    providerId: string,
    keyId: string,
    userEmail: string,
    opts: { forceRefresh?: boolean } = {},
  ): Promise<CodexAccessToken> {
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const minValid = this.deps.config.getCodexAccessMinValidSeconds();
    const keyDAO = await this.deps.providerKeyDAO();
    const key = await keyDAO.getById(keyId);
    this.assertUsable(key, providerId, userEmail);
    if (!opts.forceRefresh && key?.encrypted_access_token && (key.access_expires_at ?? 0) - now > minValid) {
      const masterKey = await this.deps.masterKey();
      return {
        accessToken: await KeyCrypto.decrypt(key.encrypted_access_token, masterKey, 'codex-oauth'),
        accountId: key.codex_account_id ?? null,
        expiresAt: key.access_expires_at as number,
      };
    }
    return this.refreshSingleFlight(keyId, () => this.refreshNow(keyId, providerId, userEmail));
  }

  public async refreshExpiring(limit: number): Promise<{ refreshed: number; revoked: number }> {
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const threshold = now + this.deps.config.getCodexAccessMinValidSeconds();
    const keyDAO = await this.deps.providerKeyDAO();
    const candidates = await keyDAO.listOAuthRefreshCandidates(now, threshold, limit).catch(() => []);
    let refreshed = 0;
    let revoked = 0;
    for (const candidate of candidates) {
      try {
        await this.refreshSingleFlight(candidate.id, () => this.refreshNow(candidate.id, candidate.provider_id, candidate.user_email));
        refreshed += 1;
      } catch (error) {
        if (error instanceof BadRequestError && /reconnect/i.test(error.message)) revoked += 1;
      }
    }
    return { refreshed, revoked };
  }

  private async refreshSingleFlight(keyId: string, task: () => Promise<CodexAccessToken>): Promise<CodexAccessToken> {
    const existing = this.inFlight.get(keyId);
    if (existing) return existing;
    const pending = task().finally(() => {
      if (this.inFlight.get(keyId) === pending) this.inFlight.delete(keyId);
    });
    this.inFlight.set(keyId, pending);
    return pending;
  }

  private async refreshNow(keyId: string, providerId: string, userEmail: string): Promise<CodexAccessToken> {
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const keyDAO = await this.deps.providerKeyDAO();
    const key = await keyDAO.getById(keyId);
    this.assertUsable(key, providerId, userEmail);
    if (!key?.encrypted_refresh_token) {
      await keyDAO.setOAuthStatus(keyId, 'expired', 'Codex authorization is incomplete. Reconnect the key.', now).catch(() => {});
      throw new BadRequestError('Codex authorization is incomplete. Reconnect the key.');
    }
    // Another isolate may have rotated already: reuse the fresh access token.
    const minValid = this.deps.config.getCodexAccessMinValidSeconds();
    if (key.encrypted_access_token && (key.access_expires_at ?? 0) - now > minValid) {
      const masterKey = await this.deps.masterKey();
      return {
        accessToken: await KeyCrypto.decrypt(key.encrypted_access_token, masterKey, 'codex-oauth'),
        accountId: key.codex_account_id ?? null,
        expiresAt: key.access_expires_at as number,
      };
    }
    const masterKey = await this.deps.masterKey();
    const oldEncryptedRefresh = key.encrypted_refresh_token;
    let refreshToken: string;
    try {
      refreshToken = await KeyCrypto.decrypt(oldEncryptedRefresh, masterKey, 'codex-oauth');
    } catch {
      await keyDAO.setOAuthStatus(keyId, 'expired', 'Codex credentials cannot be decrypted. Reconnect the key.', now).catch(() => {});
      throw new BadRequestError('Codex authorization is invalid. Reconnect the key.');
    }
    let tokens: Awaited<ReturnType<typeof CodexOAuthClient.refreshAccessToken>>;
    try {
      tokens = await CodexOAuthClient.refreshAccessToken({ refreshToken }, this.deps.fetchImpl);
    } catch (error) {
      if (error instanceof OAuth2TokenNonRetryableError) {
        const message = 'Codex authorization expired or was revoked. Reconnect the key.';
        await keyDAO.setOAuthStatus(keyId, 'revoked', message, now).catch(() => {});
        throw new BadRequestError(message);
      }
      throw error;
    }
    const [encryptedAccessToken, encryptedRefreshToken] = await Promise.all([
      KeyCrypto.encrypt(tokens.accessToken, masterKey, 'codex-oauth'),
      KeyCrypto.encrypt(tokens.refreshToken as string, masterKey, 'codex-oauth'),
    ]);
    const accessExpiresAt = TimestampUtil.getCurrentUnixTimestampInSeconds() + (tokens.expiresIn ?? FALLBACK_ACCESS_TTL_SECONDS);
    // Conditional write: losers of a cross-isolate rotation race fall through to the winner's token.
    const won = await keyDAO
      .updateOAuthRefreshedConditional(keyId, oldEncryptedRefresh, { encryptedAccessToken, encryptedRefreshToken, accessExpiresAt, now })
      .catch(() => false);
    if (!won) {
      const latest = await keyDAO.getById(keyId);
      const latestExpiry = latest?.access_expires_at ?? 0;
      if (latest?.encrypted_access_token && latestExpiry > TimestampUtil.getCurrentUnixTimestampInSeconds()) {
        return {
          accessToken: await KeyCrypto.decrypt(latest.encrypted_access_token, masterKey, 'codex-oauth'),
          accountId: latest.codex_account_id ?? null,
          expiresAt: latest.access_expires_at as number,
        };
      }
      await keyDAO.updateOAuthRefreshed(keyId, { encryptedAccessToken, encryptedRefreshToken, accessExpiresAt, now }).catch(() => {});
    }
    return { accessToken: tokens.accessToken, accountId: tokens.accountId ?? key.codex_account_id ?? null, expiresAt: accessExpiresAt };
  }

  private assertUsable(
    key: { provider_id: string; user_email: string; auth_type?: string | null; oauth_status?: string | null } | null,
    providerId: string,
    _userEmail: string,
  ): void {
    if (!key || key.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    if ((key.auth_type ?? 'static') !== 'codex_oauth') throw new BadRequestError('Key is not a Codex OAuth key');
    if (key.oauth_status === 'revoked' || key.oauth_status === 'expired') {
      throw new BadRequestError('Codex authorization expired or was revoked. Reconnect the key.');
    }
    if (key.oauth_status !== 'connected') {
      throw new BadRequestError('Codex key is not connected yet. Complete OAuth authorization first.');
    }
  }
}

export { CodexTokenService };
export type { CodexTokenServiceDeps, CodexTokenServiceEnv, CodexAccessToken };
