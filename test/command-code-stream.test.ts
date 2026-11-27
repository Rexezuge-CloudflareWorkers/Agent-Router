import { describe, expect, it } from 'vitest';
import { relayStream } from '@agent-router/backend-services/commandcode/CommandCodeStream';
import { CommandCodeAccumulator } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import type { CommandCodeEvent } from '@agent-router/provider-clients/commandcode/CommandCodeTypes';
import type { CommandCodeTranslator } from '@agent-router/backend-services/commandcode/CommandCodeTranslator';

/**
Command Code stream relay: buffered pending frames, decoder buffering across
chunk boundaries, the "done before output" error probe, and usage settlement.
*/

function translator(): CommandCodeTranslator {
  const accumulator = new CommandCodeAccumulator();
  return {
    accumulator,
    feed(event: CommandCodeEvent) {
      accumulator.add(event);
      return event.type === 'text-delta' ? [event.text ?? ''] : [];
    },
    finalize: () => [],
    finalJson: () => ({}),
    failure: () => accumulator.error,
  } as unknown as CommandCodeTranslator;
}

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

const usageOf = (acc: CommandCodeAccumulator) => ({
  promptTokens: acc.usage.inputTokens ?? 0,
  completionTokens: acc.usage.outputTokens ?? 0,
  estimated: !acc.sawFinish,
});

describe('relayStream', () => {
  it('rejects a response with no body', async () => {
    const result = await relayStream({
      upstream: new Response(null, { status: 200 }),
      translator: translator(),
      signal: new AbortController().signal,
      idleMs: 1000,
      usageOf,
    });
    expect(result.ok).toBe(false);
  });

  it('relays text deltas across chunk boundaries and settles usage', async () => {
    const t = translator();
    const upstream = new Response(
      sseStream([
        '{"type":"text-delta","text":"Hel',
        'lo"}\n{"type":"text-delta","text":" world"}\n',
        '{"type":"finish","finishReason":"stop","usage":{"inputTokens":3,"outputTokens":2}}\n',
      ]),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    );
    const result = await relayStream({
      upstream,
      translator: t,
      signal: new AbortController().signal,
      idleMs: 5000,
      usageOf,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = await new Response(result.bodyStream).text();
    expect(text).toBe('Hello world');
    const usage = await result.usagePromise;
    expect(usage.promptTokens).toBe(3);
    expect(usage.completionTokens).toBe(2);
    expect(usage.estimated).toBe(false);
  });

  it('reports a stream that ends before any output as a failure', async () => {
    const t = {
      accumulator: new CommandCodeAccumulator(),
      feed: () => [],
      finalize: () => [],
      finalJson: () => ({}),
      failure: () => ({ status: 502, type: 'upstream_error', message: 'boom' }),
    } as unknown as CommandCodeTranslator;
    const result = await relayStream({
      upstream: new Response(sseStream(['']), { status: 200 }),
      translator: t,
      signal: new AbortController().signal,
      idleMs: 5000,
      usageOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.status).toBe(502);
    expect(result.message).toBe('boom');
    expect(result.retryable).toBe(true);
  });

  it('surfaces an error event with no rendered output as an HTTP failure', async () => {
    const result = await relayStream({
      upstream: new Response(sseStream(['{"type":"error","error":{"message":"quota","statusCode":429}}\n'])),
      translator: translator(),
      signal: new AbortController().signal,
      idleMs: 1000,
      heartbeatMs: 0,
      usageOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(429);
    expect(result.code).toBeNull();
  });

  it('returns 504 instead of throwing when the upstream is silent before any data', async () => {
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start() {
          // Connected but silent: the real-world "slow thinking" failure.
        },
      }),
    );
    const result = await relayStream({
      upstream,
      translator: translator(),
      signal: new AbortController().signal,
      idleMs: 20,
      heartbeatMs: 0,
      usageOf,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(504);
    expect(result.code).toBe('STREAM_IDLE_TIMEOUT');
    expect(result.message).toContain('no data received for 20ms');
  });

  it('reports a post-start idle as an SSE error and settles failed usage', async () => {
    const t = translator();
    const encoder = new TextEncoder();
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          // A non-renderable event must not hold the HTTP response open.
          controller.enqueue(encoder.encode('{"type":"start"}\n'));
        },
      }),
    );
    const result = await relayStream({
      upstream,
      translator: t,
      signal: new AbortController().signal,
      idleMs: 20,
      heartbeatMs: 0,
      usageOf,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = await new Response(result.bodyStream).text();
    expect(text).toContain('"code":"STREAM_IDLE_TIMEOUT"');
    expect(text).toContain('no data received for 20ms');
    expect((await result.usagePromise).failed).toBe(true);
  });

  it('emits SSE comment heartbeats while waiting for the first rendered token', async () => {
    const encoder = new TextEncoder();
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"start"}\n'));
          setTimeout(() => {
            controller.enqueue(encoder.encode('{"type":"text-delta","text":"done"}\n'));
            controller.close();
          }, 40);
        },
      }),
    );
    const result = await relayStream({
      upstream,
      translator: translator(),
      signal: new AbortController().signal,
      idleMs: 500,
      heartbeatMs: 5,
      usageOf,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = await new Response(result.bodyStream).text();
    expect(text).toContain(': keep-alive');
    expect(text).toContain('done');
    expect((await result.usagePromise).failed).toBeUndefined();
  });

  it('finalizes a stream exactly once when it closes before any output', async () => {
    const t = {
      ...translator(),
      finalize: () => ['final\n'],
    } as unknown as CommandCodeTranslator;
    const result = await relayStream({
      upstream: new Response(sseStream([''])),
      translator: t,
      signal: new AbortController().signal,
      idleMs: 1000,
      heartbeatMs: 0,
      usageOf,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await new Response(result.bodyStream).text()).toBe('final\n');
  });
});
