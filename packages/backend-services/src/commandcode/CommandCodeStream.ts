import { parseLine } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import type { CommandCodeAccumulator } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import type { CommandCodeMappedError } from '@agent-router/provider-clients/commandcode/CommandCodeTypes';
import type { CommandCodeTranslator } from './CommandCodeTranslator';

/**
SSE relay + idle-timeout plumbing for the Command Code streaming path.

Kept out of `CommandCodeService` so the service stays a dispatcher and this
byte-level state machine — buffer splitting, idle timers, abort propagation,
usage settlement — can be read (and tested) on its own.
*/

const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503]);
const STREAM_IDLE_CODE = 'STREAM_IDLE_TIMEOUT';
const DEFAULT_HEARTBEAT_MS = 15_000;

class StreamIdleError extends Error {
  public readonly code: string = STREAM_IDLE_CODE;

  constructor(public readonly idleMs: number) {
    super(`Upstream stream idle timeout: no data received for ${idleMs}ms`);
    this.name = 'StreamIdleError';
  }
}

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isIdle(error: unknown): error is StreamIdleError {
  return error instanceof StreamIdleError || (error as { code?: string } | null)?.code === STREAM_IDLE_CODE;
}

/**
Reads the next chunk, rejecting if the upstream goes silent past `idleMs` or
the caller aborts. Clearing the timer/listener in `finally` is what keeps a
long-lived stream from leaking one timer per read.
*/
async function readWithIdle(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleMs: number,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal?.aborted) throw abortError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StreamIdleError(idleMs)), idleMs);
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

interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  /**
  Set when the stream failed before completion so the ledger records a failure.
  */
  failed?: boolean;
}

interface StreamRelayOptions {
  upstream: Response;
  translator: CommandCodeTranslator;
  signal: AbortSignal;
  idleMs: number;
  heartbeatMs?: number;
  usageOf: (accumulator: CommandCodeAccumulator) => UsageTotals;
}

type StreamRelayResult =
  | { ok: true; bodyStream: ReadableStream<Uint8Array>; usagePromise: Promise<UsageTotals>; initialUsage: UsageTotals }
  | { ok: false; status: number; message: string; retryable: boolean; code: string | null };

function relayFailure(failure: CommandCodeMappedError | { status: number; type: string; message: string }): StreamRelayResult {
  return {
    ok: false,
    status: failure.status,
    message: failure.message,
    retryable: RETRYABLE_STATUSES.has(failure.status),
    code: 'code' in failure ? (failure.code ?? null) : null,
  };
}

/**
Relays the Command Code SSE body to the client, feeding each parsed event into
the translator. The relay returns as soon as the upstream sends data (even
events the translator cannot render); an error event before any output is
still surfaced as an HTTP error. Idle is stripped to its real meaning: no
upstream bytes, not "no client-visible token yet".
*/
async function relayStream(options: StreamRelayOptions): Promise<StreamRelayResult> {
  const { upstream, translator, signal, idleMs, heartbeatMs = DEFAULT_HEARTBEAT_MS, usageOf } = options;
  if (!upstream.body) {
    return { ok: false, status: 502, message: 'Upstream response had no body', retryable: true, code: null };
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  let finalized: string[] | null = null;
  const pending: string[] = [];

  const finalChunks = (): string[] => (finalized ??= translator.finalize());
  const push = (text: string): void => {
    pending.push(text);
  };

  const feed = (chunk: string, emit: (text: string) => void): void => {
    buffer += chunk;
    if (!buffer.includes('\n')) return;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const event = parseLine(line);
      if (event) for (const out of translator.feed(event)) emit(out);
    }
  };

  const flush = (emit: (text: string) => void): void => {
    if (!buffer.trim()) return;
    const event = parseLine(buffer);
    buffer = '';
    if (event) for (const out of translator.feed(event)) emit(out);
  };

  // Drain only until the first upstream data. Waiting for rendered output here
  // made slow reasoning turns and non-output events look like a dead stream.
  try {
    let sawData = false;
    while (!done && pending.length === 0 && !sawData) {
      const read = await readWithIdle(reader, idleMs, signal);
      done = read.done;
      if (!read.value?.byteLength) {
        continue;
      }

      sawData = true;
      feed(decoder.decode(read.value, { stream: true }), push);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (isAbort(error)) throw error;
    return {
      ok: false,
      status: isIdle(error) ? 504 : 502,
      message: error instanceof Error ? error.message : 'Upstream stream failed',
      retryable: true,
      code: isIdle(error) ? STREAM_IDLE_CODE : null,
    };
  }

  if (done && pending.length === 0) {
    flush(push);
    const failure = translator.failure();
    if (failure) return relayFailure(failure);
  }
  // A chat-shaped error event produces no rendered chunk: surface it instead
  // of letting the idle timer mask the real upstream failure.
  if (pending.length === 0 && translator.accumulator.error) {
    const failure = translator.failure();
    if (failure) return relayFailure(failure);
  }

  let resolveUsage!: (usage: UsageTotals) => void;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
  const usagePromise = new Promise<UsageTotals>((resolve) => {
    resolveUsage = resolve;
  });
  const initialUsage = usageOf(translator.accumulator);

  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = (): void => {
    if (!heartbeat) {
      return;
    }

    clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const encoder = new TextEncoder();
      const enqueue = (text: string): void => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cancelled = true;
          stopHeartbeat();
        }
      };
      const close = (): void => {
        if (cancelled) return;
        try {
          controller.close();
        } catch {
          cancelled = true;
        }
      };
      const emitOutput = (text: string): void => {
        stopHeartbeat();
        enqueue(text);
      };

      for (const chunk of pending) enqueue(chunk);
      pending.length = 0;

      // SSE comments are ignored by clients but keep proxies and SDKs from
      // giving up while the upstream thinks before its first token.
      if (heartbeatMs > 0 && !done) {
        heartbeat = setInterval(() => enqueue(': keep-alive\n\n'), heartbeatMs);
      }

      void (async () => {
        try {
          while (!done) {
            const read = await readWithIdle(reader, idleMs, signal);
            done = read.done;
            if (!read.value) continue;
            feed(decoder.decode(read.value, { stream: true }), emitOutput);
          }
          flush(emitOutput);
          for (const chunk of finalChunks()) emitOutput(chunk);
          stopHeartbeat();
          resolveUsage(usageOf(translator.accumulator));
          close();
        } catch (error) {
          stopHeartbeat();
          if (isAbort(error)) {
            resolveUsage({ ...usageOf(translator.accumulator), failed: true });
            if (!cancelled) controller.error(error);
            return;
          }
          void reader.cancel().catch(() => {});
          const idle = isIdle(error);
          const message = error instanceof Error ? error.message : 'Upstream stream failed';
          const type = translator.accumulator.error?.status === 429 ? 'rate_limit_error' : 'upstream_error';
          enqueue(`data: ${JSON.stringify({ error: { message, type }, ...(idle && { code: STREAM_IDLE_CODE }), retry_after: 10 })}\n\n`);
          resolveUsage({ ...usageOf(translator.accumulator), failed: true });
          close();
        }
      })();
    },
    cancel: () => {
      cancelled = true;
      stopHeartbeat();
      resolveUsage({ ...usageOf(translator.accumulator), failed: true });
      void reader.cancel().catch(() => {});
    },
  });

  return { ok: true, bodyStream: stream, usagePromise, initialUsage };
}

export { DEFAULT_HEARTBEAT_MS, STREAM_IDLE_CODE, StreamIdleError, abortError, readWithIdle, relayStream, RETRYABLE_STATUSES };
export type { StreamRelayOptions, StreamRelayResult, UsageTotals };
