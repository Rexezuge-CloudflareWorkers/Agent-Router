import { describe, expect, it, vi } from 'vitest';
import { WebSearchClient, WebSearchRoutingService } from '@agent-router/backend-services/search';
import type { ProxyRequest, ProxySuccess } from '@agent-router/backend-services/router';
import type { WebSearchMode } from '@agent-router/backend-services/search';

function success(body: unknown): ProxySuccess {
  return {
    status: 200,
    bodyText: JSON.stringify(body),
    contentType: 'application/json',
    promptTokens: 1,
    completionTokens: 1,
    estimated: false,
    providerKeyId: 'pk-1',
    attempts: 1,
  };
}

async function streamText(stream: ReadableStream<Uint8Array>): Promise<string> {
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
    upstreamModel: 'gpt-5',
    bodyBytes: rawBodyText.length,
    rawBodyText,
    clientStream: false,
    signal: new AbortController().signal,
  };
}

function harness(mode: WebSearchMode, responses: ProxySuccess[], fetchImpl?: typeof fetch) {
  const settings = {
    getSettings: async () => ({ mode, selectedProviderId: mode === 'third_party' ? 'sp-brave' : null, updatedAt: null }),
  };
  const select = vi.fn(async () => [
    {
      keyId: 'sk-1',
      providerId: 'sp-brave',
      kind: 'BRAVE' as const,
      apiKey: 'brave-key',
      row: { id: 'sk-1', consecutive_failures: 0 },
    },
  ]);
  const keyPool = { select, recordSuccess: vi.fn(async () => {}), recordFailure: vi.fn(async () => {}) };
  const proxy = vi.fn(async (_req: ProxyRequest) => responses.shift() ?? success({ choices: [{ message: { content: 'ok' } }] }));
  const router = { proxy };
  const fetchMock = fetchImpl ?? vi.fn(async () => Response.json({ web: { results: [] } }));
  const searchClient = new WebSearchClient({ fetchImpl: fetchMock as unknown as typeof fetch });
  const service = new WebSearchRoutingService({
    settings: settings as never,
    router: router as never,
    keyPool: keyPool as never,
    searchClient,
  });
  return { service, proxy, fetchMock, keyPool };
}

function toolCallWith(id: string, query: string): Record<string, unknown> {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          tool_calls: [{ id, function: { name: 'web_search', arguments: JSON.stringify({ query }) } }],
        },
      },
    ],
  };
}

const toolCall = toolCallWith('c1', 'cloudflare');

function searchResponse(title: string, url: string): Response {
  return Response.json({ web: { results: [{ title, url, description: 'Snippet' }] } });
}

describe('WebSearchRoutingService', () => {
  it('leaves requests untouched in native mode', async () => {
    const body = { model: 'gpt-5', web_search_options: {}, messages: [{ role: 'user', content: 'hi' }] };
    const req = request(body);
    const { service, proxy } = harness('native', [success({ ok: true })]);
    await service.proxy(req, 'chat');
    expect(proxy).toHaveBeenCalledTimes(1);
    expect(proxy.mock.calls[0][0]).toBe(req);
  });

  it('refuses native search on Command Code rather than dropping the field', async () => {
    const { service, proxy } = harness('native', []);
    const req = { ...request({}), providerKind: 'COMMAND_CODE' as const };
    await expect(service.proxy(req, 'chat')).rejects.toThrow(/not available on Command Code/);
    expect(proxy).not.toHaveBeenCalled();
  });

  it('strips native search fields in none mode and reserializes the body', async () => {
    const req = request({ model: 'gpt-5', web_search_options: {}, messages: [] });
    const { service, proxy } = harness('none', [success({ ok: true })]);
    await service.proxy(req, 'chat');
    const sent = proxy.mock.calls[0][0] as unknown as ProxyRequest;
    expect(sent.rawBodyText).toBe('{"model":"gpt-5","messages":[]}');
    expect(sent.upstreamBody).toEqual({ model: 'gpt-5', messages: [] });
  });

  it('runs a buffered tool round trip and injects citations in third-party mode', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ web: { results: [{ title: 'Result', url: 'https://result.test', description: 'Snippet' }] } }),
    );
    const { service, proxy } = harness(
      'third_party',
      [success(toolCall), success({ choices: [{ message: { content: 'Answer [1]' } }] })],
      fetchImpl,
    );
    const result = await service.proxy(request({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }] }), 'chat');

    expect(proxy).toHaveBeenCalledTimes(2);
    const first = proxy.mock.calls[0][0] as unknown as ProxyRequest;
    const second = proxy.mock.calls[1][0] as unknown as ProxyRequest;
    expect(first.clientStream).toBe(false);
    expect((first.upstreamBody as { tools: unknown[] }).tools).toHaveLength(1);
    expect(first.upstreamBody).toMatchObject({ tool_choice: { type: 'function', function: { name: 'web_search' } } });
    expect(second.rawBodyText).not.toBe(first.rawBodyText);
    expect(second.rawBodyText).toContain('tool_call_id');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.bodyText).toContain('url_citation');
    expect(result.contentType).toBe('application/json');
  });

  it('renders SSE for streaming clients after the second call', async () => {
    const { service } = harness('third_party', [
      success(toolCall),
      success({ id: 'r', model: 'm', choices: [{ message: { content: 'Answer [1]' } }] }),
    ]);
    const req = { ...request({ model: 'gpt-5', messages: [] }), clientStream: true };
    const result = await service.proxy(req, 'chat');
    const text = await streamText(result.bodyStream!);
    expect(result.contentType).toBe('text/event-stream');
    expect(text).toContain('data: [DONE]');
    expect(text).toContain('annotations');
  });

  it('degrades to a tool result when the search provider fails', async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: 'bad key' }, { status: 401 }));
    const { service, proxy } = harness(
      'third_party',
      [success(toolCall), success({ choices: [{ message: { content: 'No sources' } }] })],
      fetchImpl,
    );
    const result = await service.proxy(request({ model: 'gpt-5', messages: [] }), 'chat');
    const second = proxy.mock.calls[1][0] as unknown as ProxyRequest;
    expect(second.rawBodyText).toContain('Web search failed');
    expect(result.bodyText).not.toContain('url_citation');
  });

  it('converges after two search rounds with globally numbered results', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => Response.json({ web: { results: [] } }));
    fetchImpl.mockResolvedValueOnce(searchResponse('One', 'https://one.test'));
    fetchImpl.mockResolvedValueOnce(searchResponse('Two', 'https://two.test'));
    const { service, proxy } = harness(
      'third_party',
      [
        success(toolCallWith('c1', 'first query')),
        success(toolCallWith('c2', 'second query')),
        success({ choices: [{ message: { content: 'Answer [1] [2]' } }] }),
      ],
      fetchImpl,
    );
    const result = await service.proxy(request({ model: 'gpt-5', messages: [] }), 'chat');

    expect(proxy).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((proxy.mock.calls[1][0] as unknown as ProxyRequest).rawBodyText).toContain('[1] One');
    expect((proxy.mock.calls[2][0] as unknown as ProxyRequest).rawBodyText).toContain('[2] Two');
    const body = JSON.parse(result.bodyText ?? '{}') as {
      choices: Array<{ message: { annotations: Array<{ url_citation: { url: string } }> } }>;
    };
    expect(body.choices[0].message.annotations.map((item) => item.url_citation.url)).toEqual(['https://one.test', 'https://two.test']);
  });

  it('forces a final no-tool call when the model keeps searching', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => searchResponse('One', 'https://one.test'));
    const { service, proxy } = harness(
      'third_party',
      [success(toolCall), success(toolCall), success(toolCall), success({ choices: [{ message: { content: 'Final [1]' } }] })],
      fetchImpl,
    );
    const result = await service.proxy(
      request({ model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], tool_choice: 'auto' }),
      'chat',
    );

    expect(proxy).toHaveBeenCalledTimes(4);
    const last = proxy.mock.calls[3][0] as unknown as ProxyRequest;
    expect((last.upstreamBody as { tools: unknown[] }).tools).toHaveLength(0);
    expect(last.upstreamBody).toMatchObject({ tool_choice: 'auto' });
    expect(last.rawBodyText).toContain('Stop searching');
    expect(result.bodyText).toContain('Final [1]');
  });

  it('executes every web_search call in a single response', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => Response.json({ web: { results: [] } }));
    fetchImpl.mockResolvedValueOnce(searchResponse('One', 'https://one.test'));
    fetchImpl.mockResolvedValueOnce(searchResponse('Two', 'https://two.test'));
    const parallel = {
      choices: [
        {
          message: {
            tool_calls: ['c1', 'c2'].map((id, index) => ({
              id,
              function: { name: 'web_search', arguments: JSON.stringify({ query: index === 0 ? 'one' : 'two' }) },
            })),
          },
        },
      ],
    };
    const { service, proxy } = harness(
      'third_party',
      [success(parallel), success({ choices: [{ message: { content: 'Done [1] [2]' } }] })],
      fetchImpl,
    );
    await service.proxy(request({ model: 'gpt-5', messages: [] }), 'chat');

    expect(proxy).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const followUp = proxy.mock.calls[1][0] as unknown as ProxyRequest;
    expect(followUp.rawBodyText).toContain('[1] One');
    expect(followUp.rawBodyText).toContain('[2] Two');
  });

  it('keeps Responses state across a tool round and replays only the tool output', async () => {
    const call = {
      output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search', arguments: '{"query":"cloudflare"}' }],
      usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
    };
    const { service, proxy } = harness('third_party', [
      success(call),
      success({
        id: 'r',
        model: 'm',
        output_text: 'Answer',
        output: [{ type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: 'Answer' }] }],
      }),
    ]);
    const body = {
      model: 'gpt-5',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      instructions: 'Be brief',
      previous_response_id: 'resp_0',
      store: true,
      reasoning: { effort: 'low' },
      stream: true,
      stream_options: { include_usage: true },
    };
    const req = { ...request(body), upstreamPath: '/responses', clientStream: true };
    const result = await service.proxy(req, 'responses');
    const text = await streamText(result.bodyStream!);

    expect(proxy).toHaveBeenCalledTimes(2);
    const first = proxy.mock.calls[0][0] as unknown as ProxyRequest;
    const second = proxy.mock.calls[1][0] as unknown as ProxyRequest;
    expect(first.clientStream).toBe(true);
    expect(first.upstreamBody).toMatchObject({
      stream: true,
      previous_response_id: 'resp_0',
      store: true,
      instructions: 'Be brief',
      reasoning: { effort: 'low' },
    });
    expect(first.upstreamBody).toHaveProperty('stream_options');
    expect(second.upstreamBody).toMatchObject({ previous_response_id: 'resp_0', store: true, instructions: 'Be brief' });
    const input = (second.upstreamBody as { input: Array<{ type?: string }> }).input;
    expect(input.some((item) => item.type === 'function_call')).toBe(false);
    expect(input).toMatchObject([{ type: 'message' }, { type: 'function_call_output', call_id: 'call_1' }]);
    expect(result.contentType).toBe('text/event-stream');
    expect(text).toContain('response.completed');
  });

  it('replays the second Responses tool call when a stored response is used', async () => {
    const calls = [
      { output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search', arguments: '{"query":"one"}' }] },
      { output: [{ type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'web_search', arguments: '{"query":"two"}' }] },
      { output_text: 'Answer [1] [2]', output: [] },
    ];
    const { service, proxy } = harness(
      'third_party',
      calls.map((body) => success(body)),
    );
    const body = {
      model: 'gpt-5',
      input: 'hi',
      previous_response_id: 'resp_0',
      stream: false,
    };
    await service.proxy({ ...request(body), upstreamPath: '/responses' }, 'responses');

    expect(proxy).toHaveBeenCalledTimes(3);
    const firstFollowUp = proxy.mock.calls[1][0] as unknown as ProxyRequest;
    const secondFollowUp = proxy.mock.calls[2][0] as unknown as ProxyRequest;
    const firstInput = (JSON.parse(firstFollowUp.rawBodyText ?? '{}') as { input: Array<{ type?: string }> }).input;
    expect(firstInput.some((item) => item.type === 'function_call')).toBe(false);
    expect(JSON.parse(secondFollowUp.rawBodyText ?? '{}')).toMatchObject({
      input: expect.arrayContaining([
        expect.objectContaining({ type: 'function_call', id: 'fc_2', call_id: 'call_2' }),
        expect.objectContaining({ type: 'function_call_output', call_id: 'call_2' }),
      ]),
    });
  });
});
