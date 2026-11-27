import { describe, expect, it, vi } from 'vitest';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import {
  buildCommandCodeEnvelope,
  buildCommandCodeHeaders,
  convertAnthropicToChat,
  convertResponsesToChat,
  generateFingerprint,
  CommandCodeService,
} from '@agent-router/backend-services/commandcode';
import { CommandCodeAccumulator, parseLine } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import { CommandCodeChatTranslator } from '@agent-router/backend-services/commandcode/CommandCodeChatTranslator';
import { CommandCodeAnthropicTranslator } from '@agent-router/backend-services/commandcode/CommandCodeAnthropicTranslator';
import { CommandCodeResponsesTranslator } from '@agent-router/backend-services/commandcode/CommandCodeResponsesTranslator';

const config = AppConfiguration.fromEnv({});

function ndjson(events: unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
}

function serviceFetch(body: string): typeof fetch {
  return vi.fn(
    async () => new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
  ) as unknown as typeof fetch;
}

function makeService(fetchImpl: typeof fetch): CommandCodeService {
  return new CommandCodeService(
    { DB: {} as never },
    {
      config,
      fetchImpl,
      keyStateDAO: () =>
        Promise.resolve({
          get: async () => null,
          markInitialized: async () => {},
        } as never),
      salt: async () => 'test-salt',
    },
  );
}

describe('Command Code fingerprint', () => {
  it('is deterministic per key and salt', async () => {
    const first = await generateFingerprint('user_secret', 'salt-a');
    const second = await generateFingerprint('user_secret', 'salt-a');
    const other = await generateFingerprint('user_secret', 'salt-b');
    expect(first).toEqual(second);
    expect(first.thumbmark).not.toBe(other.thumbmark);
  });

  it('never exposes the raw key through the components', async () => {
    const fingerprint = await generateFingerprint('user_super_secret_value', 'salt');
    expect(JSON.stringify(fingerprint)).not.toContain('user_super_secret_value');
    expect(fingerprint.components.machineIdHash).toHaveLength(64);
    expect(fingerprint.components.runtime).toBe('cli');
  });
});

describe('Command Code wire format', () => {
  it('builds the CLI envelope with system blocks, tools and capped max_tokens', () => {
    const envelope = buildCommandCodeEnvelope(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 999_999,
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'Hi' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'lookup', arguments: '{"q":1}' } }] },
          { role: 'tool', tool_call_id: 'call_1', content: 'result' },
        ],
        tools: [{ type: 'function', function: { name: 'lookup', description: '', parameters: { type: 'object' } } }],
      },
      {
        protocolVersion: '1.53.1',
        deviceProjectDir: 'C:\\Users\\dev\\app',
        cliMode: 'agent',
        emptySystemPlaceholder: true,
        zdr: false,
        sessionId: null,
      },
    );
    const params = envelope.params as Record<string, unknown>;
    expect(params.max_tokens).toBe(200_000);
    expect((params.system as unknown[])[0]).toMatchObject({ type: 'text', text: 'Be brief.' });
    expect((params.tools as unknown[])[0]).toMatchObject({ name: 'lookup' });
    const messages = params.messages as Array<Record<string, unknown>>;
    expect(messages[2]).toMatchObject({ role: 'tool' });
  });

  it('builds CLI headers and honours ZDR', () => {
    const headers = buildCommandCodeHeaders({
      secret: 'user_key',
      sessionId: '00000000-0000-4000-8000-000000000000',
      projectDir: 'C:\\Users\\dev\\app',
      protocolVersion: '1.53.1',
      zdr: true,
    });
    expect(headers.authorization).toBe('Bearer user_key');
    expect(headers['x-command-code-version']).toBe('1.53.1');
    expect(headers['x-project-slug']).toBe('c-users-dev-app');
    expect(headers['x-cmd-zdr']).toBe('1');
  });
});

describe('Command Code request conversion', () => {
  it('converts Responses requests to chat with reasoning and tool calls', () => {
    const chat = convertResponsesToChat({
      model: 'gpt-5.4',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking' }] },
        { type: 'function_call', call_id: 'call_1', name: 'lookup', arguments: '{"q":1}' },
        { type: 'function_call_output', call_id: 'call_1', output: 'ok' },
      ],
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
    });
    const messages = chat.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({ role: 'user' });
    expect(messages[1]).toMatchObject({ role: 'assistant', reasoning_content: 'thinking' });
    expect(messages[2]).toMatchObject({ role: 'tool', content: 'ok' });
  });

  it('converts Anthropic requests to chat', () => {
    const chat = convertAnthropicToChat({
      model: 'claude-sonnet-4-6',
      system: 'system prompt',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'hmm' },
            { type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 1 } },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'result' },
            { type: 'text', text: 'next' },
          ],
        },
      ],
    });
    const messages = chat.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({ role: 'system', content: 'system prompt' });
    expect(messages[1]).toMatchObject({ role: 'assistant', reasoning_content: 'hmm' });
    expect(messages[2]).toMatchObject({ role: 'tool', content: 'result' });
  });

  it('keeps plain-string Anthropic message content', () => {
    const chat = convertAnthropicToChat({
      model: 'recursive/flint-v1.0:free',
      system: 'be nice',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
        { role: 'user', content: 'bye' },
      ],
    });
    expect(chat.messages).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'bye' },
    ]);
  });
});

describe('Command Code events and translators', () => {
  it('parses NDJSON lines and accumulates usage', () => {
    expect(parseLine('not-json')).toBeNull();
    const accumulator = new CommandCodeAccumulator();
    accumulator.add({ type: 'text-delta', text: 'Hi' });
    accumulator.add({ type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 4, outputTokens: 2 } });
    expect(accumulator.text).toBe('Hi');
    expect(accumulator.usage).toMatchObject({ inputTokens: 4, outputTokens: 2 });
    expect(accumulator.incomplete()).toBeNull();
  });

  it('translates chat streams to OpenAI SSE', () => {
    const translator = new CommandCodeChatTranslator('chatcmpl-1', 1, 'm');
    const chunks = [
      ...translator.feed({ type: 'text-delta', text: 'Hel' }),
      ...translator.feed({ type: 'text-delta', text: 'lo' }),
      ...translator.feed({ type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 3, outputTokens: 1 } }),
      ...translator.finalize(),
    ].join('');
    expect(chunks).toContain('data: [DONE]');
    expect(translator.finalJson().usage).toMatchObject({ prompt_tokens: 3, completion_tokens: 1 });
  });

  it('translates Anthropic and Responses streams', () => {
    const anthropic = new CommandCodeAnthropicTranslator('m', 'msg_1');
    const anthropicOutput = [
      ...anthropic.feed({ type: 'text-delta', text: 'Hi' }),
      ...anthropic.feed({ type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1 } }),
      ...anthropic.finalize(),
    ].join('');
    expect(anthropicOutput).toContain('event: message_start');
    expect(anthropicOutput).toContain('event: message_stop');

    const responses = new CommandCodeResponsesTranslator('m', 'resp_1', 1);
    const responsesOutput = [
      ...responses.feed({ type: 'text-delta', text: 'Hi' }),
      ...responses.feed({ type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 1, outputTokens: 1 } }),
      ...responses.finalize(),
    ].join('');
    expect(responsesOutput).toContain('event: response.output_text.delta');
    expect(responsesOutput).toContain('event: response.completed');
  });
});

describe('CommandCodeService', () => {
  it('returns a buffered OpenAI response with usage', async () => {
    const body = ndjson([
      { type: 'text-delta', text: 'Hello' },
      { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 3, outputTokens: 2 } },
    ]);
    const svc = makeService(serviceFetch(body));
    const result = await svc.call({
      endpoint: 'chat',
      baseUrl: null,
      secret: 'user_key',
      keyId: 'k1',
      body: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hi' }] },
      incomingHeaders: {},
      stream: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    if (!('bodyText' in result.result)) throw new Error('expected buffered result');
    const json = JSON.parse(result.result.bodyText) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    expect(json.choices[0].message.content).toBe('Hello');
    expect(json.usage).toMatchObject({ prompt_tokens: 3, completion_tokens: 2 });
  });

  it('streams translated SSE and resolves usage', async () => {
    const body = ndjson([
      { type: 'text-delta', text: 'Hello' },
      { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 5, outputTokens: 2 } },
    ]);
    const svc = makeService(serviceFetch(body));
    const result = await svc.call({
      endpoint: 'chat',
      baseUrl: null,
      secret: 'user_key',
      keyId: 'k1',
      body: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hi' }] },
      incomingHeaders: {},
      stream: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    if (!('bodyStream' in result.result)) throw new Error('expected stream result');
    const text = await new Response(result.result.bodyStream).text();
    expect(text).toContain('Hello');
    expect(text).toContain('[DONE]');
    await expect(result.result.usagePromise).resolves.toMatchObject({ promptTokens: 5, completionTokens: 2 });
  });

  it('rejects unsupported Responses state with a non-retryable 400', async () => {
    const svc = makeService(serviceFetch(''));
    const result = await svc.call({
      endpoint: 'responses',
      baseUrl: null,
      secret: 'user_key',
      keyId: 'k1',
      body: { model: 'gpt-5.4', input: 'hi', store: true },
      incomingHeaders: {},
      stream: false,
    });
    expect(result).toMatchObject({ ok: false, status: 400, retryable: false });
  });

  it('keeps client disconnect and the total timeout bridged to a returned stream', async () => {
    const encoder = new TextEncoder();
    const upstream = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"start"}\n'));
        },
      }),
    );
    let upstreamSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return upstream;
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const result = await makeService(fetchImpl).call({
      endpoint: 'chat',
      baseUrl: null,
      secret: 'user_key',
      keyId: 'k1',
      body: { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: 'Hi' }] },
      incomingHeaders: {},
      stream: true,
      signal: controller.signal,
    });
    expect(result.ok).toBe(true);
    controller.abort();
    expect(upstreamSignal?.aborted).toBe(true);
    if (!result.ok || !('bodyStream' in result.result)) return;
    await expect(result.result.bodyStream.getReader().read()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
