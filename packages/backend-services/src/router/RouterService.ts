import { ProviderDAO, ProviderKeyDAO, UsageLedgerDAO } from '@agent-router/backend-data/dao';
import type { ProviderKeyRow } from '@agent-router/backend-data/dao';
import { BadRequestError, NotFoundError, RateLimitedError } from '@rexezuge/errors';
import { TimestampUtil } from '@rexezuge/shared';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { KeyCrypto } from '../provider/KeyCrypto';
import {
  buildCodexCall,
  buildUpstreamCall,
  extractCodexCompletedResponse,
  isRetryableStatus,
  parseUsage,
  tapUsageStream,
} from '@agent-router/provider-clients/upstream';
import type { ParsedUsage, UpstreamCall } from '@agent-router/provider-clients/upstream';
import { isCapExceeded, isOAuthKey, isOAuthUsable, recordKeyFailure } from './keyHealth';
import { recordFailedUsage, recordSuccessfulUsage } from './usageRecorder';
import { toUpstreamError, withStatusCode } from './upstreamErrors';
import type { AttemptContext, AttemptOutcome, ProxyRequest, ProxySuccess, RouterServiceDeps, RouterServiceEnv } from './types';

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

  private async buildCallForCandidate(
    candidate: ProviderKeyRow,
    req: ProxyRequest,
    masterKey: string,
    forceRefresh = false,
  ): Promise<UpstreamCall> {
    if (isOAuthKey(candidate)) {
      const resolver = this.deps.codexTokens;
      if (!resolver) throw new BadRequestError('Codex OAuth is not configured for this request');
      const tokens = await resolver.getAccessToken(req.providerId, candidate.id, req.userEmail, forceRefresh ? { forceRefresh: true } : {});
      return buildCodexCall(req.providerBaseUrl, req.upstreamPath, tokens.accessToken, tokens.accountId, req.upstreamBody);
    }
    const secret = await KeyCrypto.decrypt(candidate.encrypted_key, masterKey, 'provider-keys');
    return buildUpstreamCall(req.providerKind, req.providerBaseUrl, req.upstreamPath, secret, req.upstreamBody, undefined, req.rawBodyText);
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
  Validates the request, resolves the provider, and partitions its keys into
  usable / capped / OAuth-blocked. Throws when no usable key remains.
  */
  private async selectCandidates(req: ProxyRequest, keyDAO: ProviderKeyDAO, now: number): Promise<ProviderKeyRow[]> {
    const providerDAO = await this.deps.providerDAO();
    const provider = await providerDAO.getById(req.providerId);
    if (!provider || provider.userEmail.toLowerCase() !== req.userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    if (provider.status !== 'active') throw new BadRequestError('Provider is disabled');

    const candidates = await keyDAO.listSelectableByProvider(req.providerId, now);
    const usable = candidates.filter((k) => !isCapExceeded(k) && (!isOAuthKey(k) || isOAuthUsable(k)));
    const capped = candidates.filter((k) => isCapExceeded(k));
    const oauthBlocked = candidates.filter((k) => !isCapExceeded(k) && isOAuthKey(k) && !isOAuthUsable(k));
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
    return usable;
  }

  /** Runs one Command Code attempt and returns its outcome. Health/ledger
  bookkeeping for retryable failures happens inline; non-retryable failures
  are returned for the caller to raise. */
  private async attemptCommandCode(candidate: ProviderKeyRow, req: ProxyRequest, context: AttemptContext): Promise<AttemptOutcome> {
    const commandCode = this.deps.commandCode;
    if (!commandCode) throw new BadRequestError('Command Code is not configured for this request');
    const startedMs = Date.now();
    const secret = await KeyCrypto.decrypt(candidate.encrypted_key, context.masterKey, 'provider-keys');
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
      await recordFailedUsage(context.usageDAO, candidate, req, response.status, latencyMs);
      return { kind: 'failed', status: response.status, message: response.message, accountRouted: false };
    }
    const success = response.result;
    if ('usagePromise' in success) {
      void success.usagePromise
        .then((usage) => recordSuccessfulUsage(context.keyDAO, context.usageDAO, candidate, req, usage, latencyMs))
        .catch(() => {});
    } else {
      await recordSuccessfulUsage(context.keyDAO, context.usageDAO, candidate, req, success, latencyMs);
    }
    return {
      kind: 'success',
      success: {
        status: 200,
        ...('bodyStream' in success ? { bodyStream: success.bodyStream } : { bodyText: success.bodyText }),
        contentType: success.contentType,
        promptTokens: success.promptTokens,
        completionTokens: success.completionTokens,
        estimated: success.estimated,
        providerKeyId: candidate.id,
        attempts: 0,
      },
    };
  }

  /** Runs one standard (OpenAI/Anthropic/Gemini/Codex) attempt. Thrown
  transport/refresh errors bubble to `proxy`, which cools the key and fails over. */
  private async attemptStandard(candidate: ProviderKeyRow, req: ProxyRequest, context: AttemptContext): Promise<AttemptOutcome> {
    const startedMs = Date.now();
    let call = await this.buildCallForCandidate(candidate, req, context.masterKey);
    let accountRouted = 'ChatGPT-Account-Id' in call.headers;
    let upstream = await this.fetchWithTimeout(call, context.timeoutMs);
    // OAuth access tokens can be revoked server-side before JWT expiry:
    // force one refresh-and-retry before treating the 401 as a key failure.
    if (upstream.status === 401 && isOAuthKey(candidate)) {
      call = await this.buildCallForCandidate(candidate, req, context.masterKey, true);
      accountRouted = 'ChatGPT-Account-Id' in call.headers;
      upstream = await this.fetchWithTimeout(call, context.timeoutMs);
    }
    const latencyMs = Date.now() - startedMs;
    return this.completeStandardUpstream(upstream, candidate, req, context, { latencyMs, accountRouted, startedMs });
  }

  private async completeStandardUpstream(
    upstream: Response,
    candidate: ProviderKeyRow,
    req: ProxyRequest,
    context: AttemptContext,
    timing: { latencyMs: number; accountRouted: boolean; startedMs: number },
  ): Promise<AttemptOutcome> {
    // Streaming clients get the upstream bytes relayed as they arrive.
    if (upstream.status >= 200 && upstream.status < 300 && req.clientStream === true && upstream.body) {
      const tapped = tapUsageStream(upstream.body);
      void tapped.usage
        .then((usage) => recordSuccessfulUsage(context.keyDAO, context.usageDAO, candidate, req, usage, timing.latencyMs, upstream.status))
        .catch(() => {});
      return {
        kind: 'success',
        success: {
          status: upstream.status,
          bodyStream: tapped.stream,
          contentType: upstream.headers.get('content-type') ?? 'text/event-stream',
          promptTokens: 0,
          completionTokens: 0,
          estimated: true,
          providerKeyId: candidate.id,
          attempts: 0,
        },
      };
    }
    const bodyText = await upstream.text();
    const latencyMs = Date.now() - timing.startedMs;
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
      await recordSuccessfulUsage(context.keyDAO, context.usageDAO, candidate, req, usage, latencyMs, upstream.status);
      return {
        kind: 'success',
        success: {
          status: upstream.status,
          bodyText: responseText,
          contentType: responseContentType,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          estimated: usage.estimated,
          providerKeyId: candidate.id,
          attempts: 0,
        },
      };
    }
    await recordFailedUsage(context.usageDAO, candidate, req, upstream.status, latencyMs);
    return {
      kind: 'failed',
      status: upstream.status,
      message: bodyText.slice(0, 300) || `Upstream error ${upstream.status}`,
      accountRouted: timing.accountRouted,
    };
  }

  public async proxy(req: ProxyRequest): Promise<ProxySuccess> {
    const maxBody =
      req.providerKind === 'COMMAND_CODE' ? this.deps.config.getCommandCodeMaxBodyBytes() : this.deps.config.getProxyMaxBodyBytes();
    if (req.bodyBytes > maxBody) throw new BadRequestError('Request body too large');

    const maxAttempts = this.deps.config.getProxyMaxAttempts();
    const keyDAO = await this.deps.providerKeyDAO();
    const usageDAO = await this.deps.usageDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const usable = await this.selectCandidates(req, keyDAO, now);
    const context: AttemptContext = {
      keyDAO,
      usageDAO,
      masterKey: await this.deps.masterKey(),
      timeoutMs: this.deps.config.getProxyTimeoutMs(),
      cooldownBase: this.deps.config.getKeyCooldownBaseMs(),
      disableAfter: this.deps.config.getKeyMaxConsecutiveFailures(),
    };

    let lastError = 'Upstream request failed';
    let lastStatus = 502;
    const attempts = Math.min(maxAttempts, usable.length);
    for (let i = 0; i < attempts; i += 1) {
      const candidate = usable[i];
      try {
        const outcome =
          req.providerKind === 'COMMAND_CODE'
            ? await this.attemptCommandCode(candidate, req, context)
            : await this.attemptStandard(candidate, req, context);
        if (outcome.kind === 'success') {
          return { ...outcome.success, attempts: i + 1 };
        }
        lastStatus = outcome.status;
        lastError = outcome.message;
        if (isRetryableStatus(outcome.status)) {
          if (outcome.status === 429) {
            // Rate limits are temporary: keep the key as a last-resort
            // fallback instead of counting it toward auto-disable.
            await keyDAO.markDegraded(candidate.id, `Upstream ${outcome.status}`, now).catch(() => {});
          } else {
            await recordKeyFailure(keyDAO, candidate, `Upstream ${outcome.status}`, now, {
              baseMs: context.cooldownBase,
              disableAfter: context.disableAfter,
            });
          }
          continue;
        }
        // Non-retryable 4xx/5xx: surface upstream message, no failover.
        throw withStatusCode(
          toUpstreamError(req.providerKind, outcome.status, outcome.message, lastError, outcome.accountRouted),
          outcome.status,
        );
      } catch (error) {
        if (error instanceof BadRequestError && (error as { statusCode?: number }).statusCode) throw error;
        // A client disconnect aborts the upstream call; that says nothing about
        // key health, so do not penalize the key with a cooldown.
        if (req.signal?.aborted) throw error;
        const message = error instanceof Error ? error.message : 'Upstream request failed';
        lastError = message.slice(0, 300);
        lastStatus = 502;
        // Transient/thrown failures cool the key but do not auto-disable it;
        // only repeated upstream error statuses count toward disable.
        await recordKeyFailure(keyDAO, candidate, message, now, {
          baseMs: context.cooldownBase,
          disableAfter: Infinity,
        });
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

export { type CodexAccessResolver, type RouterServiceDeps, type RouterServiceEnv, type ProxySuccess, type ProxyRequest } from './types';
