import { BadRequestError } from '@agent-router/backend-errors';
import type { D1Queryable } from '@agent-router/backend-data/utils';
import type { AppConfiguration } from '@agent-router/backend-runtime/config';
import { TimestampUtil, UUIDUtil } from '@agent-router/shared/utils';
import { CommandCodeKeyStateDAO } from '@agent-router/backend-data/dao';
import { generateFingerprint, sha256Bytes, toHex } from './CommandCodeFingerprint';
import { buildCommandCodeEnvelope, buildCommandCodeHeaders, resolveSessionId } from './CommandCodeWire';
import { convertAnthropicToChat, convertResponsesToChat } from './CommandCodeConverters';
import { CommandCodeAccumulator, mapCcError, parseLine } from './CommandCodeEvents';
import { CommandCodeChatTranslator } from './CommandCodeChatTranslator';
import { CommandCodeAnthropicTranslator } from './CommandCodeAnthropicTranslator';
import { CommandCodeResponsesTranslator } from './CommandCodeResponsesTranslator';
import { COMMAND_CODE_FALLBACK_MODELS, normalizeProviderModels } from './CommandCodeModels';
import type { CommandCodeTranslator } from './CommandCodeTranslator';
import type {
  CommandCodeCallResult,
  CommandCodeEndpoint,
  CommandCodeModel,
  CommandCodeResult,
  CommandCodeStreamResult,
} from './CommandCodeTypes';

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

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

function stringField(value: unknown, field: string): string {
  const candidate = (value as Record<string, unknown> | null)?.[field];
  return typeof candidate === 'string' ? candidate : '';
}

const RETRYABLE_STATUSES = new Set([429, 502, 503]);

async function readWithIdle(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal?.aborted) throw abortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('STREAM_IDLE_TIMEOUT'), { code: 'STREAM_IDLE_TIMEOUT' })), idleMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([reader.read(), idle, aborted]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
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
      await dao
        .markInitialized(keyId, now + INIT_REFRESH_MS + jitter, TimestampUtil.getCurrentUnixTimestampInSeconds())
        .catch(() => undefined);
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
    let upstream: Response;
    try {
      upstream = await this.deps.fetchImpl(`${base}/alpha/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
      if (input.signal?.aborted) throw abortError();
      throw error;
    }
    try {
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        const mapped = mapCcError(upstream.status, text);
        return { ok: false, status: mapped.status, message: mapped.message, retryable: mapped.retryable, code: mapped.code };
      }
      const translator = this.translatorFor(input, chatBody);
      if (!translator) return { ok: false, status: 400, message: 'Unsupported Command Code endpoint', retryable: false, code: null };
      return input.stream
        ? await this.translateStream(upstream, translator, controller.signal)
        : await this.translateBuffered(upstream, translator);
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener('abort', onAbort);
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
    if (!upstream.body) {
      return { ok: false, status: 502, message: 'Upstream response had no body', retryable: true, code: null };
    }
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    const idleMs = this.deps.config.getCommandCodeStreamIdleMs();
    let buffer = '';
    let done = false;
    const pending: string[] = [];

    const feedChunk = (chunk: string): void => {
      buffer += chunk;
      if (!buffer.includes('\n')) return;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = parseLine(line);
        if (!event) continue;
        pending.push(...translator.feed(event));
      }
    };

    while (!done && pending.length === 0) {
      const read = await readWithIdle(reader, idleMs, signal);
      done = read.done;
      if (read.value) feedChunk(decoder.decode(read.value, { stream: true }));
    }

    if (done && pending.length === 0) {
      if (buffer.trim()) {
        const event = parseLine(buffer);
        if (event) pending.push(...translator.feed(event));
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
      pending.push(...translator.finalize());
    }

    // Promise.withResolvers is not in the ES2022 lib this package targets.
    let resolveUsage: ((usage: { promptTokens: number; completionTokens: number; estimated: boolean }) => void) | null = null;
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const usagePromise = new Promise<{ promptTokens: number; completionTokens: number; estimated: boolean }>((resolve) => {
      resolveUsage = resolve;
    });
    const initialUsage = this.usageOf(translator.accumulator);

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        const encoder = new TextEncoder();
        for (const chunk of pending) controller.enqueue(encoder.encode(chunk));
        pending.length = 0;
        void (async () => {
          try {
            while (!done) {
              const read = await readWithIdle(reader, idleMs, signal);
              done = read.done;
              if (!read.value) {
                continue;
              }

              buffer += decoder.decode(read.value, { stream: true });
              if (!buffer.includes('\n')) continue;
              const lines = buffer.split('\n');
              buffer = lines.pop() ?? '';
              for (const line of lines) {
                const event = parseLine(line);
                if (!event) continue;
                for (const chunk of translator.feed(event)) controller.enqueue(encoder.encode(chunk));
              }
            }
            if (buffer.trim()) {
              const event = parseLine(buffer);
              if (event) for (const chunk of translator.feed(event)) controller.enqueue(encoder.encode(chunk));
            }
            for (const chunk of translator.finalize()) controller.enqueue(encoder.encode(chunk));
            resolveUsage?.(this.usageOf(translator.accumulator));
            controller.close();
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              resolveUsage?.(this.usageOf(translator.accumulator));
              controller.error(error);
              return;
            }
            const message = error instanceof Error ? error.message : 'Upstream stream failed';
            const event =
              translator.accumulator.error?.status === 429
                ? `data: ${JSON.stringify({ error: { message, type: 'rate_limit_error' }, retry_after: 10 })}\n\n`
                : `data: ${JSON.stringify({ error: { message, type: 'upstream_error' }, retry_after: 10 })}\n\n`;
            controller.enqueue(new TextEncoder().encode(event));
            resolveUsage?.(this.usageOf(translator.accumulator));
            controller.close();
          }
        })();
      },
      cancel: () => {
        resolveUsage?.(this.usageOf(translator.accumulator));
        void reader.cancel().catch(() => undefined);
      },
    });

    return {
      ok: true,
      result: {
        bodyStream: stream,
        contentType: 'text/event-stream',
        ...initialUsage,
        usagePromise,
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
