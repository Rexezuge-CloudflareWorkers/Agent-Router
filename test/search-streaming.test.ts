import { describe, expect, it, vi } from 'vitest';
import { createStreamAdapter, relayStream } from '@agent-router/backend-services/search';
import { WebSearchClient, WebSearchRoutingService } from '@agent-router/backend-services/search';
import type { ProxyRequest, ProxySuccess } from '@agent-router/backend-services/router';
import type { SearchResult } from '@agent-router/backend-services/search';

const encoder = new TextEncoder();

function frame(event: string | null, data: unknown): string {
  return `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function readFrames(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const read = await reader.read();
    if (read.done) break;
    text += decoder.decode(read.value, { stream: true });
  }
  return text;
}

function payloadOf(text: string, type: string): Record<string, unknown> {
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((entry) => entry.startsWith('data:'));
    const data = line?.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    const payload = JSON.parse(data) as Record<string, unknown>;
    if (payload.type === type) return payload;
  }
  throw new Error(`Missing frame: ${type}`);
}

const results: SearchResult[] = [{ title: 'Example', url: 'https://example.com/a', snippet: 'Snippet' }];

function responseSuccess(stream: ReadableStream<Uint8Array>): ProxySuccess {
  return {
    status: 200,
    bodyStream: stream,
    contentType: 'text/event-stream',
    promptTokens: 1,
    completionTokens: 1,
    estimated: false,
    providerKeyId: 'pk-1',
    attempts: 1,
  };
}

function request(body: Record<string, unknown>): ProxyRequest {
  const rawBodyText = JSON.stringify(body);
  return {
    userEmail: 'u@x.y',
    gatewayKeyId: 'gw-1',
    providerId: 'p1',
    providerKind: 'OPENAI',
    providerBaseUrl: null,
    upstreamPath: '/chat/completions',
    upstreamBody: body,
    upstreamModel: 'm',
    bodyBytes: rawBodyText.length,
    rawBodyText,
    clientStream: true,
    signal: new AbortController().signal,
  };
}

function harness(streams: ReadableStream<Uint8Array>[]) {
  const settings = { getSettings: async () => ({ mode: 'third_party', selectedProviderId: 'sp-brave', updatedAt: null }) };
  const keyPool = {
    select: vi.fn(async () => [
      {
        keyId: 'sk-1',
        providerId: 'sp-brave',
        kind: 'BRAVE' as const,
        apiKey: 'brave-key',
        row: { id: 'sk-1', consecutive_failures: 0 },
      },
    ]),
    recordSuccess: vi.fn(async () => {}),
    recordFailure: vi.fn(async () => {}),
  };
  const proxy = vi.fn(async (_req: ProxyRequest) => responseSuccess(streams.shift() ?? streamOf([])));
  const searchClient = new WebSearchClient({
    fetchImpl: vi.fn(async () => Response.json({ web: { results: results.map((r) => ({ ...r, description: r.snippet })) } })) as never,
  });
  const service = new WebSearchRoutingService({
    settings: settings as never,
    router: { proxy } as never,
    keyPool: keyPool as never,
    searchClient,
  });
  return { service, proxy };
}

describe('streaming web search relays', () => {
  it('emits Responses deltas before the upstream stream closes and patches the completion', async () => {
    const adapter = createStreamAdapter('responses');
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first =
      frame('response.created', {
        type: 'response.created',
        response: { id: 'resp_1', model: 'm', created_at: 1, status: 'in_progress', output: [] },
      }) +
      frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'message', id: 'msg_1', status: 'in_progress', role: 'assistant', content: [] },
      }) +
      frame('response.output_text.delta', {
        type: 'response.output_text.delta',
        item_id: 'msg_1',
        output_index: 0,
        content_index: 0,
        delta: 'Hello',
      });
    const last = frame('response.completed', {
      type: 'response.completed',
      response: {
        id: 'resp_1',
        model: 'm',
        created_at: 1,
        status: 'completed',
        output_text: 'Hello world',
        output: [
          { type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'Hello world' }] },
        ],
        usage: { input_tokens: 2, output_tokens: 3 },
      },
    });
    const upstream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        controller.enqueue(encoder.encode(first));
        await gate;
        controller.enqueue(encoder.encode(last));
        controller.close();
      },
    });
    const emitted: string[] = [];
    const relaying = relayStream(upstream, adapter, (part) => emitted.push(part));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(emitted.join('')).toContain('response.output_text.delta');
    expect(emitted.join('')).not.toContain('response.completed');
    release();
    await relaying;
    const final = adapter.finish(results).join('');
    expect(final).toContain('response.output_text.annotation.added');
    const completed = payloadOf(final, 'response.completed').response as Record<string, unknown>;
    expect(completed.output_text).toBe('Hello world');
    expect(completed.usage).toMatchObject({ output_tokens: 3 });
  });

  it('filters the internal Chat tool call and streams the annotated follow-up', async () => {
    const first = streamOf([
      frame(null, {
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        created: 1,
        model: 'm',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"sun"}' } }],
            },
          },
        ],
      }) +
        frame(null, {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'm',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        }),
    ]);
    const second = streamOf([
      frame(null, {
        id: 'chatcmpl-2',
        object: 'chat.completion.chunk',
        created: 2,
        model: 'm',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'The answer' } }],
      }) +
        frame(null, {
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          created: 2,
          model: 'm',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        }),
    ]);
    const { service, proxy } = harness([first, second]);
    const body = { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true };

    const result = await service.proxy(request(body), 'chat');
    const text = await readFrames(result.bodyStream!);

    expect(proxy).toHaveBeenCalledTimes(2);
    const firstCall = proxy.mock.calls[0][0] as unknown as Record<string, unknown>;
    const secondCall = proxy.mock.calls[1][0] as unknown as Record<string, unknown>;
    expect(firstCall.upstreamBody).toMatchObject({ stream: true, tool_choice: { type: 'function', function: { name: 'web_search' } } });
    expect(secondCall.upstreamBody).toMatchObject({ stream: true });
    expect(secondCall.upstreamBody).not.toHaveProperty('tool_choice');
    expect((secondCall.upstreamBody as { tools: unknown[] }).tools).toHaveLength(0);
    expect(text).toContain('The answer');
    expect(text).not.toContain('web_search');
    expect(text).toContain('data: [DONE]');
    expect(text).toContain('https://example.com/a');
  });

  it('keeps the Responses tool request out of the stream and reuses the response id', async () => {
    const adapter = createStreamAdapter('responses');
    const frames = [
      frame('response.created', { type: 'response.created', response: { id: 'resp_1', model: 'm', created_at: 1, output: [] } }),
      frame('response.output_item.added', {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search', arguments: '{"query":"sun"}' },
      }),
      frame('response.function_call_arguments.delta', {
        type: 'response.function_call_arguments.delta',
        item_id: 'fc_1',
        delta: '{"query"',
      }),
      frame('response.completed', {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          model: 'm',
          created_at: 1,
          status: 'completed',
          output_text: '',
          output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search', arguments: '{"query":"sun"}' }],
        },
      }),
    ];
    const emitted: string[] = [];
    await relayStream(streamOf(frames), adapter, (part) => emitted.push(part));
    const text = emitted.join('');
    expect(text).not.toContain('web_search');
    expect(adapter.payload()).toMatchObject({ output: [{ name: 'web_search' }] });

    adapter.nextRound();
    const followUp = frame('response.completed', {
      type: 'response.completed',
      response: { id: 'resp_2', model: 'm', created_at: 2, status: 'completed', output_text: 'Answer', output: [] },
    });
    await relayStream(streamOf([followUp]), adapter, (part) => emitted.push(part));
    const finished = adapter.finish([]).join('');
    expect(finished).toContain('resp_1');
    expect(finished).not.toContain('resp_2');
  });

  it('filters Anthropic tool_use blocks and emits citation deltas', async () => {
    const adapter = createStreamAdapter('anthropic');
    const frames = [
      frame('message_start', {
        type: 'message_start',
        message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'm', content: [], usage: {} },
      }),
      frame('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tu_1', name: 'web_search', input: {} },
      }),
      frame('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":"sun"}' },
      }),
      frame('content_block_stop', { type: 'content_block_stop', index: 0 }),
      frame('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
      frame('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hi' } }),
      frame('content_block_stop', { type: 'content_block_stop', index: 1 }),
      frame('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} }),
      frame('message_stop', { type: 'message_stop' }),
    ];
    const emitted: string[] = [];
    await relayStream(streamOf(frames), adapter, (part) => emitted.push(part));
    expect(emitted.join('')).not.toContain('web_search');
    expect(adapter.payload()).toMatchObject({
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'web_search', input: { query: 'sun' } },
        { type: 'text', text: 'Hi' },
      ],
    });
    const finished = adapter.finish(results).join('');
    expect(finished).toContain('citations_delta');
    expect(finished).toContain('https://example.com/a');
  });

  it('filters Gemini function calls and patches grounding metadata', async () => {
    const adapter = createStreamAdapter('gemini');
    const frames = [
      frame(null, {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Hi' }, { functionCall: { name: 'web_search', args: { query: 'sun' } } }],
            },
          },
        ],
      }),
      frame(null, { candidates: [{ content: { parts: [{ text: ' there' }] } }] }),
    ];
    const emitted: string[] = [];
    await relayStream(streamOf(frames), adapter, (part) => emitted.push(part));
    const text = emitted.join('') + adapter.finish(results).join('');
    expect(text).toContain('Hi');
    expect(text).toContain(' there');
    expect(text).not.toContain('web_search');
    expect(text).toContain('groundingChunks');
  });

  it('falls back to synthesized SSE when an upstream ignores streaming', async () => {
    const { service, proxy } = harness([]);
    proxy.mockImplementation(async () => ({
      status: 200,
      bodyText: JSON.stringify({ id: 'chatcmpl-1', model: 'm', choices: [{ message: { role: 'assistant', content: 'Buffered' } }] }),
      contentType: 'application/json',
      promptTokens: 1,
      completionTokens: 1,
      estimated: false,
      providerKeyId: 'pk-1',
      attempts: 1,
    }));
    const result = await service.proxy(request({ model: 'm', messages: [], stream: true }), 'chat');
    const text = await readFrames(result.bodyStream!);
    expect(text).toContain('Buffered');
    expect(text).toContain('data: [DONE]');
  });
});
