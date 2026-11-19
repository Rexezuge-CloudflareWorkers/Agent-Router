import { ProviderDAO, ProviderKeyDAO, UsageLedgerDAO } from '@agent-router/backend-data/dao';
import type { ProviderKeyRow } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError, RateLimitedError } from '@rexezuge/errors';
import type { ProviderKind } from '@agent-router/shared';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { KeyCrypto } from '../provider/KeyCrypto';
import type { CommandCodeEndpoint, CommandCodeService } from '../commandcode';
import {
  buildCodexCall,
  buildUpstreamCall,
  extractCodexCompletedResponse,
  extractHtmlPageText,
  isRetryableStatus,
  parseUsage,
  tapUsageStream,
} from '@agent-router/provider-clients/upstream';
import type { ParsedUsage, UpstreamCall } from '@agent-router/provider-clients/upstream';

interface RouterServiceEnv {
  DB: D1Queryable;
  PROXY_TIMEOUT_MS?: string;
  PROXY_MAX_ATTEMPTS?: string;
  PROXY_MAX_BODY_BYTES?: string;
  KEY_COOLDOWN_BASE_MS?: string;
  KEY_MAX_CONSECUTIVE_FAILURES?: string;
  PROVIDER_KEYS_ENCRYPTION_SECRET?: { get(): Promise<string> };
}

interface RouterServiceDeps {
  providerDAO?: () => Promise<ProviderDAO>;
  providerKeyDAO?: () => Promise<ProviderKeyDAO>;
  usageDAO?: () => Promise<UsageLedgerDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
  fetchImpl?: typeof fetch;
  codexTokens?: CodexAccessResolver;
  commandCode?: CommandCodeService;
}

// Minimal structural surface of CodexTokenService so the router stays
// decoupled (type-only; the concrete service is wired in requestScope).
interface CodexAccessResolver {
  getAccessToken(
    providerId: string,
    keyId: string,
    userEmail: string,
    opts?: { forceRefresh?: boolean },
  ): Promise<{ accessToken: string; accountId: string | null }>;
}

interface ProxyRequest {
  userEmail: string;
  gatewayKeyId: string | null;
  providerId: string;
  providerKind: ProviderKind;
  providerBaseUrl: string | null;
  upstreamPath: string;
  upstreamBody: unknown;
  upstreamModel: string | null;
  bodyBytes: number;
  /**
  The request body exactly as the client sent it. Reused for providers that
  do not rewrite the payload so it is serialized once instead of twice.
  */
  rawBodyText?: string;
  /**
  Client-facing endpoint; Command Code collapses all of them to /alpha/generate.
  */
  clientEndpoint?: CommandCodeEndpoint;
  clientStream?: boolean;
  incomingHeaders?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

interface ProxySuccess {
  status: number;
  bodyText?: string;
  bodyStream?: ReadableStream<Uint8Array>;
  contentType: string | null;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  providerKeyId: string;
  attempts: number;
}

function cooldownForFailures(baseMs: number, failures: number): number {
  const capped = Math.min(failures, 6);
  return baseMs * 2 ** capped;
}

class RouterService {
  private readonly deps: Required<Omit<RouterServiceDeps, 'codexTokens' | 'commandCode'>> &
    Pick<RouterServiceDeps, 'codexTokens' | 'commandCode'>;

  constructor(
    private readonly env: RouterServiceEnv,
    deps: RouterServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    const masterKey =
      deps.masterKey ??
      (async () => {
        if (!env.PROVIDER_KEYS_ENCRYPTION_SECRET) throw new BadRequestError('Provider key encryption is not configured');
        return env.PROVIDER_KEYS_ENCRYPTION_SECRET.get();
      });
    this.deps = {
      providerDAO: () => Promise.resolve(new ProviderDAO(env.DB)),
      providerKeyDAO: () => Promise.resolve(new ProviderKeyDAO(env.DB)),
      usageDAO: () => Promise.resolve(new UsageLedgerDAO(env.DB)),
      masterKey,
      config,
      // Bound fetch: Workers native fetch is this-sensitive and throws
      // "Illegal invocation" when a stored bare reference is called as a
      // method (unicorn/no-unnecessary-global-this suppressed here).
      // eslint-disable-next-line unicorn/no-unnecessary-global-this
      fetchImpl: deps.fetchImpl ?? globalThis.fetch.bind(globalThis),
      codexTokens: deps.codexTokens,
      commandCode: deps.commandCode,
      ...deps,
    };
  }

  private isCapExceeded(row: ProviderKeyRow): boolean {
    if (row.token_limit !== null && row.used_tokens >= row.token_limit) return true;
    if (row.request_limit !== null && row.used_requests >= row.request_limit) return true;
    return false;
  }

  private isOAuthKey(row: ProviderKeyRow): boolean {
    return (row.auth_type ?? 'static') === 'codex_oauth';
  }

  private isOAuthUsable(row: ProviderKeyRow): boolean {
    return this.isOAuthKey(row) && row.oauth_status === 'connected' && row.encrypted_refresh_token != null;
  }

  private async buildCallForCandidate(
    candidate: ProviderKeyRow,
    req: ProxyRequest,
    masterKey: string,
    forceRefresh = false,
  ): Promise<UpstreamCall> {
    if (this.isOAuthKey(candidate)) {
      const resolver = this.deps.codexTokens;
      if (!resolver) throw new BadRequestError('Codex OAuth is not configured for this request');
      const tokens = await resolver.getAccessToken(req.providerId, candidate.id, req.userEmail, forceRefresh ? { forceRefresh: true } : {});
      return buildCodexCall(req.providerBaseUrl, req.upstreamPath, tokens.accessToken, tokens.accountId, req.upstreamBody);
    }
    const secret = await KeyCrypto.decrypt(candidate.encrypted_key, masterKey, 'provider-keys');
    return buildUpstreamCall(req.providerKind, req.providerBaseUrl, req.upstreamPath, secret, req.upstreamBody, undefined, req.rawBodyText);
  }

  private async recordUsage(
    keyDAO: ProviderKeyDAO,
    usageDAO: UsageLedgerDAO,
    candidate: ProviderKeyRow,
    req: ProxyRequest,
    usage: ParsedUsage,
    latencyMs: number,
    statusCode = 200,
  ): Promise<void> {
    await keyDAO
      .recordSuccess(candidate.id, usage.promptTokens, usage.completionTokens, TimestampUtil.getCurrentUnixTimestampInSeconds())
      .catch(() => {});
    const refreshed = await keyDAO.getById(candidate.id).catch(() => null);
    if (refreshed && this.isCapExceeded(refreshed)) {
      await keyDAO.markExhausted(candidate.id, TimestampUtil.getCurrentUnixTimestampInSeconds()).catch(() => {});
    }
    await usageDAO
      .insert({
        id: UUIDUtil.getRandomUUID(),
        userEmail: req.userEmail,
        gatewayKeyId: req.gatewayKeyId,
        providerId: req.providerId,
        providerKeyId: candidate.id,
        upstreamModel: req.upstreamModel,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        latencyMs,
        statusCode,
        errorCode: null,
        estimated: usage.estimated,
        now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
      })
      .catch(() => {});
  }

  private async fetchWithTimeout(call: UpstreamCall, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.deps.fetchImpl(call.url, { method: 'POST', headers: call.headers, body: call.body, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
  Maps a non-retryable upstream body to a client-facing error. The Codex
  backend answers failed auth/edge checks with its login HTML page
  instead of JSON; surface the page copy plus whether an account was even
  linked, rather than markup.
  */
  private static toUpstreamError(
    kind: ProviderKind,
    status: number,
    bodyText: string,
    lastError: string,
    accountRouted: boolean,
  ): BadRequestError {
    if (kind === 'OPENAI_CODEX' && /^\s*</.test(bodyText)) {
      const text = extractHtmlPageText(bodyText);
      const message = accountRouted
        ? `Codex backend returned a login page (status ${status}) even with a linked account — likely an access challenge from this network.`
        : `Codex backend returned a login page (status ${status}) and no ChatGPT account is linked to this key. Re-import the full auth JSON so the account id is stored, then retry.`;
      return new BadRequestError(`${message}${text ? ` Page: ${text}` : ''}`.slice(0, 400));
    }
    return new BadRequestError(lastError.slice(0, 300));
  }

  public async proxy(req: ProxyRequest): Promise<ProxySuccess> {
    const maxBody =
      req.providerKind === 'COMMAND_CODE' ? this.deps.config.getCommandCodeMaxBodyBytes() : this.deps.config.getProxyMaxBodyBytes();
    if (req.bodyBytes > maxBody) throw new BadRequestError('Request body too large');
    const maxAttempts = this.deps.config.getProxyMaxAttempts();
    const timeoutMs = this.deps.config.getProxyTimeoutMs();
    const cooldownBase = this.deps.config.getKeyCooldownBaseMs();
    const disableAfter = this.deps.config.getKeyMaxConsecutiveFailures();

    const providerDAO = await this.deps.providerDAO();
    const provider = await providerDAO.getById(req.providerId);
    if (!provider || provider.userEmail.toLowerCase() !== req.userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    if (provider.status !== 'active') throw new BadRequestError('Provider is disabled');

    const keyDAO = await this.deps.providerKeyDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const candidates = await keyDAO.listActiveByProvider(req.providerId, now);
    const usable = candidates.filter((k) => !this.isCapExceeded(k) && (!this.isOAuthKey(k) || this.isOAuthUsable(k)));
    const capped = candidates.filter((k) => this.isCapExceeded(k));
    const oauthBlocked = candidates.filter((k) => !this.isCapExceeded(k) && this.isOAuthKey(k) && !this.isOAuthUsable(k));
    // Mark newly-capped keys exhausted best-effort (does not block the request).
    for (const key of capped) {
      await keyDAO.markExhausted(key.id, now).catch(() => {});
    }
    if (usable.length === 0) {
      if (oauthBlocked.length > 0 && capped.length === 0) {
        throw new BadRequestError('Codex OAuth keys require reconnection. Complete OAuth authorization for the key and retry.');
      }
      throw new RateLimitedError('All provider keys are exhausted or cooling. Try again later.');
    }

    const masterKey = await this.deps.masterKey();
    const usageDAO = await this.deps.usageDAO();
    let lastError = 'Upstream request failed';
    let lastStatus = 502;
    let lastAccountRouted = false;
    const attempts = Math.min(maxAttempts, usable.length);
    for (let i = 0; i < attempts; i += 1) {
      const candidate = usable[i];
      const startedMs = Date.now();
      try {
        if (req.providerKind === 'COMMAND_CODE') {
          const commandCode = this.deps.commandCode;
          if (!commandCode) throw new BadRequestError('Command Code is not configured for this request');
          const secret = await KeyCrypto.decrypt(candidate.encrypted_key, masterKey, 'provider-keys');
          await commandCode.ensureInitialized(secret, candidate.id, req.providerBaseUrl, req.signal);
          const response = await commandCode.call({
            endpoint: req.clientEndpoint ?? 'chat',
            baseUrl: req.providerBaseUrl,
            secret,
            keyId: candidate.id,
            body: req.upstreamBody,
            incomingHeaders: req.incomingHeaders ?? {},
            stream: req.clientStream === true,
            signal: req.signal,
          });
          const latencyMs = Date.now() - startedMs;
          if (!response.ok) {
            lastStatus = response.status;
            lastError = response.message;
            if (response.retryable) {
              const failures = candidate.consecutive_failures + 1;
              const cooldownUntil =
                failures >= disableAfter
                  ? null
                  : TimestampUtil.getCurrentUnixTimestampInSeconds() + Math.ceil(cooldownForFailures(cooldownBase, failures) / 1000);
              await keyDAO
                .recordFailure(candidate.id, `Upstream ${response.status}`, cooldownUntil, TimestampUtil.getCurrentUnixTimestampInSeconds())
                .catch(() => {});
              await usageDAO
                .insert({
                  id: UUIDUtil.getRandomUUID(),
                  userEmail: req.userEmail,
                  gatewayKeyId: req.gatewayKeyId,
                  providerId: req.providerId,
                  providerKeyId: candidate.id,
                  upstreamModel: req.upstreamModel,
                  promptTokens: 0,
                  completionTokens: 0,
                  latencyMs,
                  statusCode: response.status,
                  errorCode: `UPSTREAM_${response.status}`,
                  estimated: false,
                  now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
                })
                .catch(() => {});
              continue;
            }
            await usageDAO
              .insert({
                id: UUIDUtil.getRandomUUID(),
                userEmail: req.userEmail,
                gatewayKeyId: req.gatewayKeyId,
                providerId: req.providerId,
                providerKeyId: candidate.id,
                upstreamModel: req.upstreamModel,
                promptTokens: 0,
                completionTokens: 0,
                latencyMs,
                statusCode: response.status,
                errorCode: `UPSTREAM_${response.status}`,
                estimated: false,
                now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
              })
              .catch(() => {});
            const error = new BadRequestError(response.message.slice(0, 300));
            (error as unknown as { statusCode?: number }).statusCode = response.status;
            throw error;
          }

          const success = response.result;
          if ('usagePromise' in success) {
            void success.usagePromise.then((usage) => this.recordUsage(keyDAO, usageDAO, candidate, req, usage, latencyMs)).catch(() => {});
          } else {
            await this.recordUsage(keyDAO, usageDAO, candidate, req, success, latencyMs);
          }
          return {
            status: 200,
            ...('bodyStream' in success ? { bodyStream: success.bodyStream } : { bodyText: success.bodyText }),
            contentType: success.contentType,
            promptTokens: success.promptTokens,
            completionTokens: success.completionTokens,
            estimated: success.estimated,
            providerKeyId: candidate.id,
            attempts: i + 1,
          };
        }
        let call = await this.buildCallForCandidate(candidate, req, masterKey);
        lastAccountRouted = 'ChatGPT-Account-Id' in call.headers;
        let upstream = await this.fetchWithTimeout(call, timeoutMs);
        // OAuth access tokens can be revoked server-side before JWT expiry:
        // force one refresh-and-retry before treating the 401 as a key failure.
        if (upstream.status === 401 && this.isOAuthKey(candidate)) {
          try {
            call = await this.buildCallForCandidate(candidate, req, masterKey, true);
            lastAccountRouted = 'ChatGPT-Account-Id' in call.headers;
            upstream = await this.fetchWithTimeout(call, timeoutMs);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Upstream request failed';
            lastError = message.slice(0, 300);
            lastStatus = 401;
            const failures = candidate.consecutive_failures + 1;
            const cooldownUntil =
              TimestampUtil.getCurrentUnixTimestampInSeconds() + Math.ceil(cooldownForFailures(cooldownBase, failures) / 1000);
            await keyDAO
              .recordFailure(candidate.id, message.slice(0, 500), cooldownUntil, TimestampUtil.getCurrentUnixTimestampInSeconds())
              .catch(() => {});
            continue;
          }
        }
        // Streaming clients get the upstream bytes relayed as they arrive.
        // Buffering first made every streaming call pay for the whole response
        // before the client saw a byte — the main CPU sink on long /responses
        // generations.
        if (upstream.status >= 200 && upstream.status < 300 && req.clientStream === true && upstream.body) {
          const latencyMs = Date.now() - startedMs;
          const tapped = tapUsageStream(upstream.body);
          void tapped.usage
            .then((usage) => this.recordUsage(keyDAO, usageDAO, candidate, req, usage, latencyMs, upstream.status))
            .catch(() => {});
          return {
            status: upstream.status,
            bodyStream: tapped.stream,
            contentType: upstream.headers.get('content-type') ?? 'text/event-stream',
            promptTokens: 0,
            completionTokens: 0,
            estimated: true,
            providerKeyId: candidate.id,
            attempts: i + 1,
          };
        }
        const bodyText = await upstream.text();
        const latencyMs = Date.now() - startedMs;
        // The Codex backend only serves SSE: non-streaming clients get the
        // completed response object re-assembled as JSON (raw SSE relay when
        // assembly finds nothing).
        let responseText = bodyText;
        let responseContentType: string | null = null;
        if (req.providerKind === 'OPENAI_CODEX') {
          const assembled = extractCodexCompletedResponse(bodyText);
          if (assembled === null) {
            responseContentType = 'text/event-stream';
          } else {
            responseText = assembled;
            responseContentType = 'application/json';
          }
        }
        if (upstream.status >= 200 && upstream.status < 300) {
          let usage: ParsedUsage = { promptTokens: 0, completionTokens: 0, estimated: true };
          try {
            usage = parseUsage(req.providerKind, JSON.parse(responseText));
          } catch {
            usage = { promptTokens: 0, completionTokens: 0, estimated: true };
          }
          await this.recordUsage(keyDAO, usageDAO, candidate, req, usage, latencyMs, upstream.status);
          return {
            status: upstream.status,
            bodyText: responseText,
            contentType: responseContentType,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            estimated: usage.estimated,
            providerKeyId: candidate.id,
            attempts: i + 1,
          };
        }
        lastStatus = upstream.status;
        lastError = bodyText.slice(0, 300) || `Upstream error ${upstream.status}`;
        if (isRetryableStatus(upstream.status)) {
          const failures = candidate.consecutive_failures + 1;
          const cooldownUntil =
            failures >= disableAfter
              ? null
              : TimestampUtil.getCurrentUnixTimestampInSeconds() + Math.ceil(cooldownForFailures(cooldownBase, failures) / 1000);
          await keyDAO
            .recordFailure(candidate.id, `Upstream ${upstream.status}`, cooldownUntil, TimestampUtil.getCurrentUnixTimestampInSeconds())
            .catch(() => {});
          if (failures >= disableAfter) {
            const db = (keyDAO as unknown as { database: { prepare(q: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } } })
              .database;
            await db
              .prepare(`UPDATE provider_keys SET status = 'disabled', updated_at = ? WHERE id = ?`)
              .bind(TimestampUtil.getCurrentUnixTimestampInSeconds(), candidate.id)
              .run()
              .catch(() => {});
          }
          await usageDAO
            .insert({
              id: UUIDUtil.getRandomUUID(),
              userEmail: req.userEmail,
              gatewayKeyId: req.gatewayKeyId,
              providerId: req.providerId,
              providerKeyId: candidate.id,
              upstreamModel: req.upstreamModel,
              promptTokens: 0,
              completionTokens: 0,
              latencyMs,
              statusCode: upstream.status,
              errorCode: `UPSTREAM_${upstream.status}`,
              estimated: false,
              now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
            })
            .catch(() => {});
          continue;
        }
        // Non-retryable 4xx: surface upstream message, no failover.
        await usageDAO
          .insert({
            id: UUIDUtil.getRandomUUID(),
            userEmail: req.userEmail,
            gatewayKeyId: req.gatewayKeyId,
            providerId: req.providerId,
            providerKeyId: candidate.id,
            upstreamModel: req.upstreamModel,
            promptTokens: 0,
            completionTokens: 0,
            latencyMs,
            statusCode: upstream.status,
            errorCode: `UPSTREAM_${upstream.status}`,
            estimated: false,
            now: TimestampUtil.getCurrentUnixTimestampInSeconds(),
          })
          .catch(() => {});
        const error = RouterService.toUpstreamError(req.providerKind, upstream.status, bodyText, lastError, lastAccountRouted);
        (error as unknown as { statusCode?: number }).statusCode = upstream.status;
        throw error;
      } catch (error) {
        if (error instanceof BadRequestError && (error as unknown as { statusCode?: number }).statusCode) throw error;
        // A client disconnect aborts the upstream call; that says nothing about
        // key health, so do not penalize the key with a cooldown.
        if (req.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : 'Upstream request failed';
        lastError = message.slice(0, 300);
        lastStatus = 502;
        const failures = candidate.consecutive_failures + 1;
        const cooldownUntil =
          TimestampUtil.getCurrentUnixTimestampInSeconds() + Math.ceil(cooldownForFailures(cooldownBase, failures) / 1000);
        await keyDAO
          .recordFailure(candidate.id, message.slice(0, 500), cooldownUntil, TimestampUtil.getCurrentUnixTimestampInSeconds())
          .catch(() => {});
      }
    }
    // lastError carries the final upstream body slice (<=300 chars, no
    // secrets); include it so callers can tell account quota from key
    // cooldown instead of guessing behind a generic message.
    if (lastStatus === 429) {
      const detail = lastError.slice(0, 200).trim();
      throw new RateLimitedError(
        detail && detail !== 'Upstream request failed'
          ? `All provider keys are rate limited. Upstream: ${detail}`
          : 'All provider keys are rate limited. Try again later.',
      );
    }
    throw new BadRequestError(lastError.slice(0, 300) || 'Upstream request failed');
  }
}

export { RouterService };
export type { RouterServiceDeps, RouterServiceEnv, ProxyRequest, ProxySuccess, CodexAccessResolver };
