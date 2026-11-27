import { describe, expect, it, vi } from 'vitest';
import { Tokens } from '@agent-router/backend-services/composition';
import { handleAnthropicProxy, handleOpenAiProxy } from '@agent-router/backend-services/proxy';
import type { ProxyIdentity } from '@agent-router/backend-services/proxy';

const identity: ProxyIdentity = { userEmail: 'u@x.y', gatewayKeyId: 'gw-1' };

const CONTINUE_PREFERENCE = { mode: 'continue', fallbackModel: null };

function scopeWith(
  proxy: (input: Record<string, unknown>) => Promise<unknown>,
  opts: {
    provider?: Record<string, unknown>;
    preference?: { mode: string; fallbackModel: string | null };
    onPreferenceLookup?: (keyId: string) => void;
  } = {},
): never {
  const { provider, preference, onPreferenceLookup } = opts;
  const resolvedProvider = provider ?? { id: 'p1', kind: 'OPENAI', status: 'active', baseUrl: null, name: 'p1' };
  const resolvedPreference = preference ?? CONTINUE_PREFERENCE;
  return {
    get(token: unknown) {
      if (token === Tokens.AppConfig) {
        return {
          getProxyMaxBodyBytes: () => 4096,
          getCommandCodeMaxBodyBytes: () => 4096,
        };
      }
      if (token === Tokens.ProviderService) return { listProviders: async () => [resolvedProvider] };
      if (token === Tokens.RouterService) return { proxy };
      if (token === Tokens.GatewayKeyService) {
        return {
          getPeakPreference: async (keyId: string) => {
            onPreferenceLookup?.(keyId);
            return resolvedPreference;
          },
        };
      }
      throw new Error('unexpected token');
    },
  } as never;
}

function request(body: string): Request {
  return new Request('https://agent-router.test/v1/responses', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
  });
}

describe('proxy operations', () => {
  it('parses the body once and forwards the original text unmodified', async () => {
    const text = '{"model":"gpt-5",  "input":"hi"}';
    const proxy = vi.fn(async (_input: unknown) => ({
      status: 200,
      bodyText: '{"ok":true}',
      contentType: 'application/json',
      providerKeyId: 'pk-1',
    }));
    const response = await handleOpenAiProxy({} as never, request(text), '/responses', identity, () => scopeWith(proxy));

    expect(response.status).toBe(200);
    expect(response.headers.get('x-provider-key-id')).toBe('pk-1');
    const input = proxy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(input.rawBodyText).toBe(text);
    expect(input.bodyBytes).toBe(new TextEncoder().encode(text).byteLength);
    expect(input.clientStream).toBe(false);
    expect(input.gatewayKeyId).toBe('gw-1');
  });

  it('marks streaming requests so the router relays instead of buffering', async () => {
    const proxy = vi.fn(async (_input: unknown) => ({
      status: 200,
      bodyStream: new ReadableStream<Uint8Array>(),
      contentType: 'text/event-stream',
      providerKeyId: 'pk-1',
    }));
    const body = '{"model":"gpt-5","input":"hi","stream":true}';
    const response = await handleOpenAiProxy({} as never, request(body), '/responses', identity, () => scopeWith(proxy));

    const input = proxy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(input.clientStream).toBe(true);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
  });

  it('rejects bodies larger than the configured limit before resolving a provider', async () => {
    const proxy = vi.fn(async (_input: unknown) => ({
      status: 200,
      providerKeyId: 'pk-1',
      contentType: 'application/json',
      bodyText: '{}',
    }));
    const providerService = { listProviders: vi.fn() };
    const scope = {
      get(token: unknown) {
        if (token === Tokens.AppConfig) return { getProxyMaxBodyBytes: () => 8, getCommandCodeMaxBodyBytes: () => 8 };
        if (token === Tokens.ProviderService) return providerService;
        return { proxy };
      },
    } as never;

    const response = await handleOpenAiProxy({} as never, request('{"model":"gpt-5"}'), '/responses', identity, () => scope);
    expect(response.status).toBe(413);
    expect(proxy).not.toHaveBeenCalled();
    expect(providerService.listProviders).not.toHaveBeenCalled();
  });

  it('rejects non-JSON bodies', async () => {
    const response = await handleOpenAiProxy({} as never, request('not json'), '/responses', identity, () =>
      scopeWith(async () => ({ status: 200, contentType: 'application/json', providerKeyId: 'pk-1', bodyText: '{}' })),
    );
    expect(response.status).toBe(400);
  });

  it('keeps the Anthropic passthrough for anthropic and command-code providers', async () => {
    const proxy = vi.fn(async (_input: unknown) => ({
      status: 200,
      bodyText: '{}',
      contentType: 'application/json',
      providerKeyId: 'pk-1',
    }));
    const anthropic = { id: 'p1', kind: 'ANTHROPIC', status: 'active', baseUrl: null, name: 'p1' };
    const body = '{"model":"claude-sonnet-4","max_tokens":16}';
    const response = await handleAnthropicProxy({} as never, request(body), identity, () => scopeWith(proxy, { provider: anthropic }));
    expect(response.status).toBe(200);
    const input = proxy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(input.clientEndpoint).toBe('anthropic');
    expect(input.rawBodyText).toBe(body);
  });

  // Mon 10:00 Asia/Shanghai — inside DeepSeek's 09:00-12:00 peak window.
  const PEAK_MONDAY = new Date('2026-01-05T02:00:00Z');

  function deepseekScope(
    proxy: (input: Record<string, unknown>) => Promise<unknown>,
    preference: { mode: string; fallbackModel: string | null },
  ) {
    const commandCode = { id: 'p1', kind: 'COMMAND_CODE', status: 'active', baseUrl: null, name: 'p1' };
    return scopeWith(proxy, { provider: commandCode, preference });
  }

  it('rejects a peak model during peak hours when the user prefers reject', async () => {
    vi.useFakeTimers({ now: PEAK_MONDAY, toFake: ['Date'] });
    try {
      const proxy = vi.fn(async (_input: unknown) => ({
        status: 200,
        bodyText: '{}',
        contentType: 'application/json',
        providerKeyId: 'pk-1',
      }));
      const response = await handleOpenAiProxy({} as never, request('{"model":"deepseek/deepseek-v4-pro"}'), '/chat', identity, () =>
        deepseekScope(proxy, { mode: 'reject', fallbackModel: null }),
      );
      expect(response.status).toBe(429);
      expect(proxy).not.toHaveBeenCalled();
      const payload = (await response.json()) as { error: { type: string } };
      expect(payload.error.type).toBe('peak_hours');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rewrites to the fallback model during peak hours', async () => {
    vi.useFakeTimers({ now: PEAK_MONDAY, toFake: ['Date'] });
    try {
      const proxy = vi.fn(async (_input: unknown) => ({
        status: 200,
        bodyText: '{}',
        contentType: 'application/json',
        providerKeyId: 'pk-1',
      }));
      const response = await handleOpenAiProxy({} as never, request('{"model":"deepseek/deepseek-v4-pro"}'), '/chat', identity, () =>
        deepseekScope(proxy, { mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' }),
      );
      expect(response.status).toBe(200);
      const input = proxy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
      expect(input.upstreamModel).toBe('moonshotai/Kimi-K2.5');
      expect(input.upstreamBody).toMatchObject({ model: 'moonshotai/Kimi-K2.5' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('looks up the peak policy by the authenticated gateway key id', async () => {
    vi.useFakeTimers({ now: PEAK_MONDAY, toFake: ['Date'] });
    try {
      const keyIds: string[] = [];
      const proxy = vi.fn(async (_input: unknown) => ({
        status: 200,
        bodyText: '{}',
        contentType: 'application/json',
        providerKeyId: 'pk-1',
      }));
      const commandCode = { id: 'p1', kind: 'COMMAND_CODE', status: 'active', baseUrl: null, name: 'p1' };
      await handleOpenAiProxy({} as never, request('{"model":"deepseek/deepseek-v4-pro"}'), '/chat', identity, () =>
        scopeWith(proxy, {
          provider: commandCode,
          preference: { mode: 'continue', fallbackModel: null },
          onPreferenceLookup: (keyId) => keyIds.push(keyId),
        }),
      );
      expect(keyIds).toEqual([identity.gatewayKeyId]);
    } finally {
      vi.useRealTimers();
    }
  });
});
