import { describe, expect, it } from 'vitest';
import { anthropicAdapter, codexAdapter, geminiAdapter, getAdapter, openAiAdapter } from '@agent-router/provider-clients/adapters';

describe('provider adapters', () => {
  it('builds an OpenAI call with Bearer auth', () => {
    const call = openAiAdapter.buildCall({
      baseUrl: 'https://api.openai.com/v1',
      path: '/chat/completions',
      secret: 'sk-1',
      body: { model: 'gpt-4o' },
    });
    expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(call.headers.authorization).toBe('Bearer sk-1');
    expect(JSON.parse(call.body)).toEqual({ model: 'gpt-4o' });
  });

  it('reuses the raw body when provided instead of re-serializing', () => {
    const call = openAiAdapter.buildCall({
      baseUrl: 'https://api.openai.com/v1',
      path: '/chat/completions',
      secret: 'sk-1',
      body: { model: 'ignored' },
      rawBody: '{"model":"raw"}',
    });
    expect(call.body).toBe('{"model":"raw"}');
  });

  it('builds an Anthropic call with x-api-key and version header', () => {
    const call = anthropicAdapter.buildCall({
      baseUrl: null,
      path: '/v1/messages',
      secret: 'sk-ant',
      body: { model: 'claude' },
    });
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers['x-api-key']).toBe('sk-ant');
    expect(call.headers['anthropic-version']).toBe('2023-06-01');
  });

  it('puts the Gemini key in the query string, separator-aware', () => {
    const call = geminiAdapter.buildCall({
      baseUrl: 'https://generativelanguage.googleapis.com',
      path: '/v1beta/models/gemini-pro:generateContent',
      secret: 'key 1',
      body: {},
    });
    expect(call.url).toContain('?key=key%201');
    const withQuery = geminiAdapter.buildCall({
      baseUrl: 'https://g.example.com',
      path: '/x?a=1',
      secret: 'k',
      body: {},
    });
    expect(withQuery.url).toContain('&key=k');
  });

  it('parses usage per provider shape', () => {
    expect(openAiAdapter.parseUsage({ usage: { prompt_tokens: 4, completion_tokens: 2 } })).toEqual({
      promptTokens: 4,
      completionTokens: 2,
      estimated: false,
    });
    // Responses API dialect (input/output tokens).
    expect(openAiAdapter.parseUsage({ usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 } })).toEqual({
      promptTokens: 8,
      completionTokens: 3,
      estimated: false,
    });
    expect(anthropicAdapter.parseUsage({ usage: { input_tokens: 5, output_tokens: 1 } })).toEqual({
      promptTokens: 5,
      completionTokens: 1,
      estimated: false,
    });
    // Total-only fallback (OpenAI/Gemini).
    expect(openAiAdapter.parseUsage({ usage: { total_tokens: 9 } })).toEqual({
      promptTokens: 9,
      completionTokens: 0,
      estimated: false,
    });
    // Missing usage is estimated.
    expect(openAiAdapter.parseUsage({})).toEqual({ promptTokens: 0, completionTokens: 0, estimated: true });
  });

  it('normalizes a Codex body and pins store/stream', () => {
    const call = codexAdapter.buildCall({
      baseUrl: 'https://api.openai.com/v1',
      path: '/responses',
      secret: 'tok',
      body: { input: 'hi', store: true, stream: false },
    });
    const body = JSON.parse(call.body);
    expect(body.store).toBe(false);
    expect(body.stream).toBe(true);
    expect(body.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]);
    // Legacy platform URL is redirected to the Codex backend.
    expect(call.url).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(call.headers['OpenAI-Beta']).toBe('responses=experimental');
  });

  it('maps provider kinds to adapters and leaves Command Code out', () => {
    expect(getAdapter('OPENAI')).toBe(openAiAdapter);
    expect(getAdapter('OPENAI_COMPAT')).toBe(openAiAdapter);
    expect(getAdapter('ANTHROPIC')).toBe(anthropicAdapter);
    expect(getAdapter('GEMINI')).toBe(geminiAdapter);
    expect(getAdapter('OPENAI_CODEX')).toBe(codexAdapter);
    expect(getAdapter('COMMAND_CODE')).toBeNull();
  });
});
