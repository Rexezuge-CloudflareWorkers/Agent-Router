import { describe, expect, it } from 'vitest';
import {
  appendAnswerDirective,
  appendToolResult,
  appendToolResults,
  bufferedBody,
  bufferedUpstreamPath,
  findSearchToolCall,
  findSearchToolCalls,
  injectSearchTool,
  removeSearchTool,
  stripNativeSearch,
} from '@agent-router/backend-services/search/requestShapes';
import { injectCitations, toSse } from '@agent-router/backend-services/search/responseShapes';
import type { SearchResult } from '@agent-router/backend-services/search';

const results: SearchResult[] = [{ title: 'Source', url: 'https://source.test', snippet: 'A snippet' }];

describe('web search request shapes', () => {
  it('strips native search flags on every endpoint', () => {
    const chat = { web_search_options: {}, tools: [{ type: 'web_search' }, { type: 'function' }] };
    expect(stripNativeSearch(chat, 'chat')).toBe(true);
    expect(chat).toEqual({ tools: [{ type: 'function' }] });

    const responses = { tools: [{ type: 'web_search_preview' }, { type: 'function', name: 'other' }] };
    expect(stripNativeSearch(responses, 'responses')).toBe(true);
    expect(responses.tools).toHaveLength(1);

    const anthropic = { tools: [{ type: 'web_search_20250305', name: 'web_search' }] };
    expect(stripNativeSearch(anthropic, 'anthropic')).toBe(true);
    expect(anthropic.tools).toEqual([]);

    const gemini = { tools: [{ googleSearch: {} }, { functionDeclarations: [] }] };
    expect(stripNativeSearch(gemini, 'gemini')).toBe(true);
    expect(gemini.tools).toEqual([{ functionDeclarations: [] }]);
  });

  it('injects one generic tool in each native shape', () => {
    const chat: Record<string, unknown> = {};
    injectSearchTool(chat, 'chat');
    expect((chat.tools as Array<Record<string, unknown>>)[0].function).toMatchObject({ name: 'web_search' });

    const responses: Record<string, unknown> = {};
    injectSearchTool(responses, 'responses');
    expect((responses.tools as Array<Record<string, unknown>>)[0]).toMatchObject({ type: 'function', name: 'web_search' });

    const anthropic: Record<string, unknown> = {};
    injectSearchTool(anthropic, 'anthropic');
    expect((anthropic.tools as Array<Record<string, unknown>>)[0].input_schema).toBeDefined();

    const gemini: Record<string, unknown> = {};
    injectSearchTool(gemini, 'gemini');
    expect((gemini.tools as Array<Record<string, unknown>>)[0].functionDeclarations).toHaveLength(1);

    injectSearchTool(chat, 'chat');
    expect(chat.tools).toHaveLength(1);
  });

  it('detects a web_search call in every response shape', () => {
    expect(
      findSearchToolCall(
        { choices: [{ message: { tool_calls: [{ id: 'c1', function: { name: 'web_search', arguments: '{"query":"one"}' } }] } }] },
        'chat',
      ),
    ).toEqual({ id: 'c1', query: 'one' });
    expect(
      findSearchToolCall(
        { output: [{ type: 'function_call', call_id: 'f1', name: 'web_search', arguments: '{"query":"two"}' }] },
        'responses',
      ),
    ).toEqual({ id: 'f1', query: 'two' });
    expect(
      findSearchToolCall({ content: [{ type: 'tool_use', id: 't1', name: 'web_search', input: { query: 'three' } }] }, 'anthropic'),
    ).toEqual({
      id: 't1',
      query: 'three',
    });
    expect(
      findSearchToolCall(
        { candidates: [{ content: { parts: [{ functionCall: { name: 'web_search', args: { query: 'four' } } }] } }] },
        'gemini',
      ),
    ).toEqual({ id: 'call_web_search_0', query: 'four' });
    expect(findSearchToolCall({ choices: [{ message: { content: 'done' } }] }, 'chat')).toBeNull();
  });

  it('keeps both the Responses item id and the call id for stateful replay', () => {
    const call = findSearchToolCall(
      {
        output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search', arguments: '{"query":"two"}' }],
      },
      'responses',
    );
    expect(call).toEqual({ id: 'call_1', itemId: 'fc_1', query: 'two' });
    expect(call).not.toBeNull();
    if (!call) return;

    const stored: Record<string, unknown> = {
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    };
    appendToolResult(stored, 'responses', call, 'found');
    expect(stored.input).toMatchObject([
      { type: 'message' },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'web_search' },
      { type: 'function_call_output', call_id: 'call_1', output: 'found' },
    ]);

    // With a stored prior response only the tool output is sent back.
    const stateful: Record<string, unknown> = {
      previous_response_id: 'resp_1',
      store: true,
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
    };
    appendToolResult(stateful, 'responses', call, 'found');
    expect(stateful.input).toMatchObject([{ type: 'message' }, { type: 'function_call_output', call_id: 'call_1', output: 'found' }]);
  });

  it('appends the tool call and result in each native request shape', () => {
    const chat: Record<string, unknown> = { messages: [{ role: 'user', content: 'hi' }] };
    appendToolResult(chat, 'chat', { id: 'c1', query: 'q' }, 'found');
    expect(chat.messages).toHaveLength(3);
    expect((chat.messages as Array<Record<string, unknown>>)[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: 'found' });

    const responses: Record<string, unknown> = { input: 'hi' };
    appendToolResult(responses, 'responses', { id: 'f1', query: 'q' }, 'found');
    const input = responses.input as Array<Record<string, unknown>>;
    expect(input[0]).toMatchObject({ type: 'message', role: 'user' });
    expect(input[2]).toMatchObject({ type: 'function_call_output', call_id: 'f1', output: 'found' });

    const anthropic: Record<string, unknown> = { messages: [{ role: 'user', content: 'hi' }] };
    appendToolResult(anthropic, 'anthropic', { id: 't1', query: 'q' }, 'found');
    expect((anthropic.messages as Array<Record<string, unknown>>)[2].content).toMatchObject([{ tool_use_id: 't1', content: 'found' }]);

    const gemini: Record<string, unknown> = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
    appendToolResult(gemini, 'gemini', { id: 'g1', query: 'q' }, 'found');
    expect((gemini.contents as Array<Record<string, unknown>>)[2].parts).toMatchObject([{ functionResponse: { name: 'web_search' } }]);
  });

  it('collects every web search call and appends several results', () => {
    const payload = {
      choices: [
        {
          message: {
            tool_calls: ['a', 'b', 'a'].map((id, index) => ({
              id,
              function: { name: 'web_search', arguments: JSON.stringify({ query: index === 2 ? 'q0' : `q${index}` }) },
            })),
          },
        },
      ],
    };
    expect(findSearchToolCalls(payload, 'chat').map((call) => call.query)).toEqual(['q0', 'q1']);
    const body: Record<string, unknown> = { messages: [] };
    appendToolResults(body, 'chat', findSearchToolCalls(payload, 'chat'), ['first', 'second']);
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(4);
    expect(messages[1]).toMatchObject({ role: 'tool', content: 'first' });
    expect(messages[3]).toMatchObject({ role: 'tool', content: 'second' });
  });

  it('removes only the injected tool and appends a final answer directive', () => {
    const body: Record<string, unknown> = {
      messages: [],
      tools: [
        { type: 'function', function: { name: 'other' } },
        { type: 'function', function: { name: 'web_search' } },
      ],
    };
    removeSearchTool(body, 'chat');
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'other' } }]);
    appendAnswerDirective(body, 'chat');
    expect((body.messages as Array<Record<string, unknown>>)[0]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('Stop searching'),
    });

    const gemini: Record<string, unknown> = {
      contents: [],
      tools: [{ functionDeclarations: [{ name: 'web_search' }, { name: 'other' }] }],
    };
    removeSearchTool(gemini, 'gemini');
    expect(gemini.tools).toMatchObject([{ functionDeclarations: [{ name: 'other' }] }]);
    appendAnswerDirective(gemini, 'gemini');
    expect(gemini.contents).toHaveLength(1);
  });

  it('forces buffered calls for the two-phase flow', () => {
    expect(bufferedBody({ stream: true }, 'chat')).toEqual({ stream: false });
    expect(bufferedBody({ stream: true, stream_options: { include_usage: true } }, 'responses')).toEqual({ stream: false });
    expect(bufferedUpstreamPath('gemini', '/v1beta/models/g:streamGenerateContent')).toBe('/v1beta/models/g:generateContent');
  });
});

describe('web search response shapes', () => {
  it('injects citations for every client shape', () => {
    const chat = injectCitations({ choices: [{ message: { role: 'assistant', content: 'See [1]' } }] }, results, 'chat');
    expect((chat.choices as Array<Record<string, unknown>>)[0]).toHaveProperty('message.annotations');

    const responses = injectCitations(
      { output: [{ type: 'message', content: [{ type: 'output_text', text: 'See [1]' }] }], output_text: 'See [1]' },
      results,
      'responses',
    );
    expect(responses.output).toMatchObject([{ content: [{ annotations: [{ type: 'url_citation' }] }] }]);

    const anthropic = injectCitations({ content: [{ type: 'text', text: 'See [1]' }] }, results, 'anthropic');
    expect(anthropic.content).toMatchObject([{ citations: [{ type: 'web_search_result_location' }] }]);

    const gemini = injectCitations({ candidates: [{ content: { parts: [{ text: 'See [1]' }] } }] }, results, 'gemini');
    expect(gemini.candidates).toMatchObject([
      { groundingMetadata: { groundingChunks: [{ web: { uri: 'https://source.test', title: 'Source' } }] } },
    ]);
  });

  it('anchors citations precisely instead of highlighting the whole answer', () => {
    const marked = 'See [1] for details';
    const markedBody = injectCitations({ choices: [{ message: { content: marked } }] }, results, 'chat');
    const markedCitation = (
      markedBody.choices as Array<{ message: { annotations: Array<{ url_citation: { start_index: number; end_index: number } }> } }>
    )[0].message.annotations[0].url_citation;
    expect(markedCitation.start_index).toBe(marked.indexOf('[1]'));
    expect(markedCitation.end_index).toBe(marked.indexOf('[1]') + 3);

    const domained = 'Visit source.test for details';
    const domainedBody = injectCitations({ choices: [{ message: { content: domained } }] }, results, 'chat');
    const domainedCitation = (
      domainedBody.choices as Array<{ message: { annotations: Array<{ url_citation: { start_index: number; end_index: number } }> } }>
    )[0].message.annotations[0].url_citation;
    expect(domainedCitation.start_index).toBe(domained.indexOf('source.test'));

    const unmatched = 'Nothing here';
    const unmatchedBody = injectCitations({ choices: [{ message: { content: unmatched } }] }, results, 'chat');
    const unmatchedCitation = (
      unmatchedBody.choices as Array<{ message: { annotations: Array<{ url_citation: { start_index: number; end_index: number } }> } }>
    )[0].message.annotations[0].url_citation;
    expect(unmatchedCitation.start_index).toBe(unmatched.length);
    expect(unmatchedCitation.end_index).toBe(unmatched.length);
  });

  it('renders native SSE frames with final citations', () => {
    const chat = toSse({ id: 'x', model: 'm', choices: [{ message: { content: 'See [1]' } }] }, results, 'chat');
    expect(chat).toContain('chat.completion.chunk');
    expect(chat).toContain('annotations');
    expect(chat).toContain('data: [DONE]');

    const responses = toSse({ id: 'r', model: 'm', output_text: 'See [1]', output: [] }, results, 'responses');
    expect(responses).toContain('response.output_text.annotation.added');
    expect(responses).toContain('response.completed');

    const anthropic = toSse({ id: 'a', model: 'm', content: [{ type: 'text', text: 'See [1]' }] }, results, 'anthropic');
    expect(anthropic).toContain('content_block_start');
    expect(anthropic).toContain('web_search_result_location');

    const gemini = toSse({ candidates: [{ content: { parts: [{ text: 'See [1]' }] } }] }, results, 'gemini');
    expect(gemini).toContain('groundingMetadata');
  });

  it('renders every Responses output item for streaming clients', () => {
    const payload = {
      id: 'r',
      model: 'm',
      output_text: 'See [1]',
      output: [
        { type: 'reasoning', id: 'rs_1', summary: [{ type: 'summary_text', text: 'thinking' }] },
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'other', arguments: '{"a":1}' },
        { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'See [1]' }] },
      ],
    };
    const frames = toSse(payload, results, 'responses');

    expect(frames).toContain('response.reasoning_text.delta');
    expect(frames).toContain('response.function_call_arguments.done');
    expect(frames).toContain('"id":"rs_1"');
    expect(frames).toContain('"id":"fc_1"');
    expect(frames).toContain('"id":"msg_1"');
    expect(frames).toContain('response.output_text.annotation.added');
    const completed = frames.split('\n').findLast((line) => line.startsWith('data: ') && line.includes('"type":"response.completed"'));
    expect(completed).toBeDefined();
    const response = JSON.parse(completed?.slice(6) ?? '{}') as { response: { output: Array<{ type: string }> } };
    expect(response.response.output.map((item) => item.type)).toEqual(['reasoning', 'function_call', 'message']);
  });
});
