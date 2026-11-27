import { BadRequestError } from '@rexezuge/errors';
import type { D1Queryable } from '@rexezuge/d1';
import type { AppConfiguration } from '@agent-router/backend-runtime/config';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import { CommandCodeKeyStateDAO } from '@agent-router/backend-data/dao';
import { generateFingerprint, sha256Bytes, toHex } from '@agent-router/provider-clients/commandcode/CommandCodeFingerprint';
import {
  buildCommandCodeEnvelope,
  buildCommandCodeHeaders,
  resolveSessionId,
} from '@agent-router/provider-clients/commandcode/CommandCodeWire';
import { convertAnthropicToChat, convertResponsesToChat } from './CommandCodeConverters';
import { mapCcError, parseLine } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import type { CommandCodeAccumulator } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import { abortError, relayStream, RETRYABLE_STATUSES } from './CommandCodeStream';
import { CommandCodeChatTranslator } from './CommandCodeChatTranslator';
import { CommandCodeAnthropicTranslator } from './CommandCodeAnthropicTranslator';
import { CommandCodeResponsesTranslator } from './CommandCodeResponsesTranslator';
import { COMMAND_CODE_FALLBACK_MODELS, normalizeProviderModels } from '@agent-router/provider-clients/commandcode/CommandCodeModels';
import type { CommandCodeTranslator } from './CommandCodeTranslator';
import type {
  CommandCodeCallResult,
  CommandCodeEndpoint,
  CommandCodeModel,
  CommandCodeResult,
  CommandCodeStreamResult,
} from '@agent-router/provider-clients/commandcode/CommandCodeTypes';

interface CommandCodeServiceEnv {
  DB: D1Queryable;
  COMMAND_CODE_FINGERPRINT_SALT?: { get(): Promise<string> };
}

interface CommandCodeServiceDeps {
  config: AppConfiguration;
  keyStateDAO?: () => Promise<CommandCodeKeyStateDAO>;
  fetchImpl?: typeof fetch;
  salt?: () => Promise<string>;
  now?: () => number;
  random?: () => number;
}

interface CommandCodeCallInput {
  endpoint: CommandCodeEndpoint;
  baseUrl: string | null;
  secret: string;
  keyId: string;
  body: unknown;
  incomingHeaders: Record<string, string | undefined>;
  stream: boolean;
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = 'https://api.commandcode.ai';
const INIT_REFRESH_MS = 8 * 60 * 60 * 1000;
const INIT_JITTER_MS = 2 * 60 * 60 * 1000;

const fingerprintCache = new Map<string, { fingerprint: Awaited<ReturnType<typeof generateFingerprint>>; key: string }>();
const modelCache = new Map<string, { models: CommandCodeModel[]; expiresAt: number }>();

function stringField(value: unknown, field: string): string {
  const candidate = (value as Record<string, unknown> | null)?.[field];
  return typeof candidate === 'string' ? candidate : '';
}

class CommandCodeService {
  private readonly deps: Required<CommandCodeServiceDeps>;

  constructor(
    private readonly env: CommandCodeServiceEnv,
    deps: CommandCodeServiceDeps,
  ) {
    this.deps = {
      keyStateDAO: () => Promise.resolve(new CommandCodeKeyStateDAO(env.DB)),
      // eslint-disable-next-line unicorn/no-unnecessary-global-this
      fetchImpl: globalThis.fetch.bind(globalThis),
      salt: async () => {
        return env.COMMAND_CODE_FINGERPRINT_SALT ? env.COMMAND_CODE_FINGERPRINT_SALT.get() : '';
      },
      now: () => Date.now(),
      // Non-security jitter for the 8h fingerprint refresh window.
      // eslint-disable-next-line sonarjs/pseudo-random
      random: () => Math.random(),
      ...deps,
    };
  }

  public async ensureInitialized(secret: string, keyId: string, baseUrl: string | null, signal?: AbortSignal): Promise<void> {
    const now = this.deps.now();
    const dao = await this.deps.keyStateDAO();
    const state = await dao.get(keyId).catch(() => null);
    if (state && state.next_init_at > now) return;

    const fingerprint = await this.fingerprintFor(secret, keyId);
    const headers = buildCommandCodeHeaders({
      secret,
      sessionId: `sess_${toHex(crypto.getRandomValues(new Uint8Array(8)))}`,
      projectDir: this.deps.config.getCommandCodeDeviceProjectDir(),
      protocolVersion: this.deps.config.getCommandCodeProtocolVersion(),
      zdr: this.deps.config.isCommandCodeZdrEnabled(),
    });
    const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    try {
      const [fingerprintResponse, lifecycleResponse] = await Promise.all([
        this.deps.fetchImpl(`${base}/alpha/fingerprint/record`, {
          method: 'POST',
          headers,
          body: JSON.stringify(fingerprint),
          signal,
        }),
        this.deps.fetchImpl(`${base}/alpha/lifecycle-events`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            eventType: 'cli_session_exists',
            metadata: {
              sessionId: `sess_${toHex(crypto.getRandomValues(new Uint8Array(8)))}`,
              cliVersion: this.deps.config.getCommandCodeProtocolVersion(),
              mode: this.deps.config.getCommandCodeCliSessionMode(),
              os: 'win32-x64',
            },
          }),
          signal,
        }),
      ]);
      if (!fingerprintResponse.ok || !lifecycleResponse.ok) return;
      const jitter = Math.floor(this.deps.random() * INIT_JITTER_MS);
      await dao.markInitialized(keyId, now + INIT_REFRESH_MS + jitter, TimestampUtil.getCurrentUnixTimestampInSeconds()).catch(() => {});
    } catch {
      // Pre-requests are best-effort: the generation request still proceeds.
    }
  }

  public async call(input: CommandCodeCallInput): Promise<CommandCodeCallResult> {
    let chatBody: unknown;
    try {
      chatBody = this.toChatBody(input.endpoint, input.body);
    } catch (error) {
      return {
        ok: false,
        status: 400,
        message: error instanceof Error ? error.message : 'Invalid request body',
        retryable: false,
        code: null,
      };
    }
    const sessionId = await resolveSessionId(
      input.incomingHeaders,
      input.secret,
      buildCommandCodeEnvelope(chatBody, this.wireOptions(null)),
      stringField(chatBody, 'prompt_cache_key'),
    );
    const envelope = buildCommandCodeEnvelope(chatBody, this.wireOptions(sessionId));
    const headers = buildCommandCodeHeaders({
      secret: input.secret,
      sessionId,
      projectDir: this.deps.config.getCommandCodeDeviceProjectDir(),
      protocolVersion: this.deps.config.getCommandCodeProtocolVersion(),
      zdr: this.deps.config.isCommandCodeZdrEnabled() || input.incomingHeaders['x-cmd-zdr'] === '1',
    });
    const base = (input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.config.getCommandCodeTimeoutMs());
    const onAbort = (): void => controller.abort();
    input.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = (): void => {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
    };
    let upstream: Response;
    try {
      upstream = await this.deps.fetchImpl(`${base}/alpha/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
    } catch (error) {
      cleanup();
      if (input.signal?.aborted) throw abortError();
      throw error;
    }
    let streamUsage: Promise<unknown> | undefined;
    try {
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        const mapped = mapCcError(upstream.status, text);
        return { ok: false, status: mapped.status, message: mapped.message, retryable: mapped.retryable, code: mapped.code };
      }
      const translator = this.translatorFor(input, chatBody);
      if (!translator) return { ok: false, status: 400, message: 'Unsupported Command Code endpoint', retryable: false, code: null };
      if (input.stream) {
        const result = await this.translateStream(upstream, translator, controller.signal);
        if (result.ok && 'usagePromise' in result.result) streamUsage = result.result.usagePromise;
        return result;
      }
      return await this.translateBuffered(upstream, translator);
    } finally {
      // A returned stream outlives this call: keep the total timeout and the
      // client-disconnect bridge armed until the relay settles its usage.
      if (streamUsage) void streamUsage.then(cleanup).catch(cleanup);
      else cleanup();
    }
  }

  public async listModels(providerId: string, secret: string, baseUrl: string | null): Promise<CommandCodeModel[]> {
    const now = this.deps.now();
    const cached = modelCache.get(providerId);
    if (cached && cached.expiresAt > now) return cached.models;
    const base = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    try {
      const response = await this.deps.fetchImpl(`${base}/provider/v1/models`, {
        headers: {
          authorization: `Bearer ${secret}`,
          'x-cli-environment': 'production',
          'x-command-code-version': this.deps.config.getCommandCodeProtocolVersion(),
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const models = normalizeProviderModels(await response.json());
        if (models) {
          modelCache.set(providerId, { models, expiresAt: now + this.deps.config.getCommandCodeModelsTtlMs() });
          return models;
        }
      }
    } catch {
      // Fall back to the static catalogue.
    }
    return [...COMMAND_CODE_FALLBACK_MODELS];
  }

  private async translateBuffered(upstream: Response, translator: CommandCodeTranslator): Promise<CommandCodeCallResult> {
    const body = await upstream.text();
    for (const line of body.split('\n')) {
      const event = parseLine(line);
      if (event) translator.feed(event);
    }
    const failure = translator.failure();
    if (failure) {
      return {
        ok: false,
        status: failure.status,
        message: failure.message,
        retryable: RETRYABLE_STATUSES.has(failure.status),
        code: null,
      };
    }
    translator.finalize();
    const usage = this.usageOf(translator.accumulator);
    return {
      ok: true,
      result: {
        bodyText: JSON.stringify(translator.finalJson()),
        contentType: 'application/json',
        ...usage,
      } satisfies CommandCodeResult,
    };
  }

  private async translateStream(
    upstream: Response,
    translator: CommandCodeTranslator,
    signal: AbortSignal,
  ): Promise<CommandCodeCallResult> {
    const relayed = await relayStream({
      upstream,
      translator,
      signal,
      idleMs: this.deps.config.getCommandCodeStreamIdleMs(),
      heartbeatMs: this.deps.config.getCommandCodeStreamHeartbeatMs(),
      usageOf: (accumulator) => this.usageOf(accumulator),
    });
    if (!relayed.ok) {
      return { ok: false, status: relayed.status, message: relayed.message, retryable: relayed.retryable, code: relayed.code };
    }
    return {
      ok: true,
      result: {
        bodyStream: relayed.bodyStream,
        contentType: 'text/event-stream',
        ...relayed.initialUsage,
        usagePromise: relayed.usagePromise,
      } satisfies CommandCodeStreamResult,
    };
  }

  private translatorFor(input: CommandCodeCallInput, chatBody: unknown): CommandCodeTranslator | null {
    const model = stringField(chatBody, 'model');
    if (input.endpoint === 'chat') {
      return new CommandCodeChatTranslator(`chatcmpl-${UUIDUtil.getRandomUUID().slice(0, 12)}`, Math.floor(this.deps.now() / 1000), model);
    }
    return input.endpoint === 'anthropic'
      ? new CommandCodeAnthropicTranslator(model, `msg_${UUIDUtil.getRandomUUID().slice(0, 12)}`)
      : new CommandCodeResponsesTranslator(model, `resp_${UUIDUtil.getRandomUUID().slice(0, 12)}`, Math.floor(this.deps.now() / 1000));
  }

  private toChatBody(endpoint: CommandCodeEndpoint, body: unknown): unknown {
    if (endpoint === 'responses') {
      const record = body as { store?: unknown; previous_response_id?: unknown } | null;
      if (record && (record.store === true || record.previous_response_id)) {
        throw new BadRequestError('Command Code does not support store or previous_response_id');
      }
      return convertResponsesToChat(body);
    }
    return endpoint === 'anthropic' ? convertAnthropicToChat(body) : body;
  }

  private wireOptions(sessionId: string | null) {
    return {
      protocolVersion: this.deps.config.getCommandCodeProtocolVersion(),
      deviceProjectDir: this.deps.config.getCommandCodeDeviceProjectDir(),
      cliMode: this.deps.config.getCommandCodeCliMode(),
      emptySystemPlaceholder: this.deps.config.isCommandCodeEmptySystemPlaceholderEnabled(),
      zdr: this.deps.config.isCommandCodeZdrEnabled(),
      sessionId,
    };
  }

  private usageOf(accumulator: CommandCodeAccumulator): { promptTokens: number; completionTokens: number; estimated: boolean } {
    return {
      promptTokens: accumulator.usage.inputTokens ?? 0,
      completionTokens: accumulator.usage.outputTokens ?? 0,
      estimated: !accumulator.sawFinish,
    };
  }

  private async fingerprintFor(secret: string, keyId: string): Promise<Awaited<ReturnType<typeof generateFingerprint>>> {
    const secretHash = toHex(await sha256Bytes(secret)).slice(0, 24);
    const cached = fingerprintCache.get(keyId);
    if (cached && cached.key === secretHash) return cached.fingerprint;
    const salt = await this.deps.salt();
    const fingerprint = await generateFingerprint(secret, salt);
    fingerprintCache.set(keyId, { fingerprint, key: secretHash });
    return fingerprint;
  }
}

export { CommandCodeService };
export type { CommandCodeCallInput, CommandCodeServiceDeps, CommandCodeServiceEnv };
