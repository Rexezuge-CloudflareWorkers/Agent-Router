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
    failure: () => null,
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
});
