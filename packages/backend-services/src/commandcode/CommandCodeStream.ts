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

function abortError(): Error {
  return new DOMException('The operation was aborted', 'AbortError');
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

interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

interface StreamRelayOptions {
  upstream: Response;
  translator: CommandCodeTranslator;
  signal: AbortSignal;
  idleMs: number;
  usageOf: (accumulator: CommandCodeAccumulator) => UsageTotals;
}

type StreamRelayResult =
  | { ok: true; bodyStream: ReadableStream<Uint8Array>; usagePromise: Promise<UsageTotals>; initialUsage: UsageTotals }
  | { ok: false; status: number; message: string; retryable: boolean };

/**
Relays the Command Code SSE body to the client, feeding each parsed event into
the translator. The first event batch is resolved *before* returning so an
immediate upstream failure becomes an error response rather than a 200 stream
that closes instantly.
*/
async function relayStream(options: StreamRelayOptions): Promise<StreamRelayResult> {
  const { upstream, translator, signal, idleMs, usageOf } = options;
  if (!upstream.body) {
    return { ok: false, status: 502, message: 'Upstream response had no body', retryable: true };
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
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
      if (event) pending.push(...translator.feed(event));
    }
  };

  // Drain until the first client-visible output (or the stream ends) so an
  // early upstream error can be returned as a proper error status.
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
    const failure = translator.failure() as CommandCodeMappedError | null;
    if (failure) {
      return { ok: false, status: failure.status, message: failure.message, retryable: RETRYABLE_STATUSES.has(failure.status) };
    }
    pending.push(...translator.finalize());
  }

  let resolveUsage!: (usage: UsageTotals) => void;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
  const usagePromise = new Promise<UsageTotals>((resolve) => {
    resolveUsage = resolve;
  });
  const initialUsage = usageOf(translator.accumulator);

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
            if (!read.value) continue;
            buffer += decoder.decode(read.value, { stream: true });
            if (!buffer.includes('\n')) continue;
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const event = parseLine(line);
              if (event) for (const chunk of translator.feed(event)) controller.enqueue(encoder.encode(chunk));
            }
          }
          if (buffer.trim()) {
            const event = parseLine(buffer);
            if (event) for (const chunk of translator.feed(event)) controller.enqueue(encoder.encode(chunk));
          }
          for (const chunk of translator.finalize()) controller.enqueue(encoder.encode(chunk));
          resolveUsage(usageOf(translator.accumulator));
          controller.close();
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            resolveUsage(usageOf(translator.accumulator));
            controller.error(error);
            return;
          }
          const message = error instanceof Error ? error.message : 'Upstream stream failed';
          const event =
            translator.accumulator.error?.status === 429
              ? `data: ${JSON.stringify({ error: { message, type: 'rate_limit_error' }, retry_after: 10 })}\n\n`
              : `data: ${JSON.stringify({ error: { message, type: 'upstream_error' }, retry_after: 10 })}\n\n`;
          controller.enqueue(new TextEncoder().encode(event));
          resolveUsage(usageOf(translator.accumulator));
          controller.close();
        }
      })();
    },
    cancel: () => {
      resolveUsage(usageOf(translator.accumulator));
      void reader.cancel().catch(() => {});
    },
  });

  return { ok: true, bodyStream: stream, usagePromise, initialUsage };
}

export { abortError, readWithIdle, relayStream, RETRYABLE_STATUSES };
export type { StreamRelayOptions, StreamRelayResult, UsageTotals };
