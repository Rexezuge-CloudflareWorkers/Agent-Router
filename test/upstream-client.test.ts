import { describe, expect, it } from 'vitest';
import {
  buildCodexCall,
  buildUpstreamCall,
  extractCodexCompletedResponse,
  extractHtmlPageText,
  isRetryableStatus,
  parseUsage,
} from '@agent-router/backend-services/router';

describe('UpstreamClient', () => {
  it('builds OpenAI bearer calls', () => {
    const call = buildUpstreamCall('OPENAI', null, '/chat/completions', 'sk-x', { model: 'gpt-4o' });
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer sk-x');
  });

  it('builds Anthropic x-api-key calls', () => {
    const call = buildUpstreamCall('ANTHROPIC', null, '/v1/messages', 'sk-ant', { model: 'claude-3-5-sonnet-20241022' });
    expect(call.headers['x-api-key']).toBe('sk-ant');
    expect(call.headers['anthropic-version']).toBeDefined();
  });

  it('builds Gemini key-query calls', () => {
    const call = buildUpstreamCall('GEMINI', null, '/v1beta/models/gemini-2.0-flash:generateContent', 'g-key', {});
    expect(call.url).toContain('key=g-key');
    expect(call.headers.authorization).toBeUndefined();
  });

  it('builds Codex calls against the Codex backend, mapping legacy platform urls', () => {
    expect(buildCodexCall(null, '/responses', 'at-1', 'acc-1', {}).url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(buildCodexCall('https://api.openai.com/v1', '/responses', 'at-1', null, {}).url).toBe(
      'https://chatgpt.com/backend-api/codex/responses',
    );
    expect(buildCodexCall(null, '/responses', 'at-1', 'acc-1', {}).headers['ChatGPT-Account-Id']).toBe('acc-1');
  });

  it('wraps string inputs and forces store:false for the Codex backend', () => {
    const call = JSON.parse(buildCodexCall(null, '/responses', 'at-1', null, { model: 'gpt-5.5', input: 'hi' }).body) as {
      input: unknown;
      store: unknown;
    };
    expect(call.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]);
    expect(call.store).toBe(false);
    const passthrough = JSON.parse(
      buildCodexCall(null, '/responses', 'at-1', null, { model: 'gpt-5.5', input: [{ type: 'message', role: 'user', content: 'hi' }] })
        .body,
    ) as { input: unknown };
    expect(passthrough.input).toEqual([{ type: 'message', role: 'user', content: 'hi' }]);
  });

  it('forces stream:true on Codex-bound bodies', () => {
    const call = JSON.parse(buildCodexCall(null, '/responses', 'at-1', null, { model: 'gpt-5.5', input: 'hi' }).body) as {
      stream: unknown;
    };
    expect(call.stream).toBe(true);
  });

  it('extracts the completed response from Codex SSE', () => {
    const sse = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"r1"}}',
      '',
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"hi"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"r1","output_text":"hi"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    expect(JSON.parse(extractCodexCompletedResponse(sse) as string)).toEqual({
      id: 'r1',
      output_text: 'hi',
      output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] }],
    });
    expect(extractCodexCompletedResponse('data: {"type":"response.output_text.delta","delta":"hi"}\n')).toBeNull();
    expect(extractCodexCompletedResponse('not an event stream')).toBeNull();
  });

  it('rebuilds Codex output from stream events when the completed snapshot is empty', () => {
    const sse = [
      'event: response.output_item.done',
      'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"hi"}]}}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"r1","output":[]}}',
      '',
    ].join('\n');
    expect(JSON.parse(extractCodexCompletedResponse(sse) as string)).toMatchObject({
      id: 'r1',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }],
    });
    const deltas = [
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"hey"}',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"r2","output":[]}}',
    ].join('\n');
    expect(JSON.parse(extractCodexCompletedResponse(deltas) as string)).toMatchObject({
      output: [{ content: [{ text: 'hey' }] }],
    });
  });

  it('extracts page copy from HTML errors, dropping style content', () => {
    const html = '<html><head><style>body{color:red}</style></head><body><h1>Just a moment</h1><p>Verify you are human</p></body></html>';
    expect(extractHtmlPageText(html)).toBe('Just a moment Verify you are human');
  });

  it('parses Codex usage from input/output tokens', () => {
    expect(parseUsage('OPENAI_CODEX', { usage: { input_tokens: 12, output_tokens: 44, total_tokens: 56 } })).toMatchObject({
      promptTokens: 12,
      completionTokens: 44,
      estimated: false,
    });
    expect(parseUsage('OPENAI_CODEX', {})).toMatchObject({ estimated: true });
  });

  it('parses usage per kind', () => {
    expect(parseUsage('OPENAI', { usage: { prompt_tokens: 5, completion_tokens: 7 } })).toMatchObject({
      promptTokens: 5,
      completionTokens: 7,
      estimated: false,
    });
    expect(parseUsage('ANTHROPIC', { usage: { input_tokens: 4, output_tokens: 6 } })).toMatchObject({
      promptTokens: 4,
      completionTokens: 6,
    });
    expect(parseUsage('OPENAI', {})).toMatchObject({ estimated: true });
  });

  it('classifies retryable statuses', () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
  });
});
