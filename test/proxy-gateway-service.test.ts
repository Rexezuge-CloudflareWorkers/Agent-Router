import { describe, expect, it, vi } from 'vitest';
import { Tokens } from '@agent-router/backend-services/composition';
import { handleAnthropicProxy, handleOpenAiProxy } from '@agent-router/backend-services/proxy';
import type { ProxyIdentity } from '@agent-router/backend-services/proxy';

const identity: ProxyIdentity = { userEmail: 'u@x.y', gatewayKeyId: 'gw-1' };

function scopeWith(proxy: (input: Record<string, unknown>) => Promise<unknown>, provider?: Record<string, unknown>): never {
  const resolvedProvider = provider ?? { id: 'p1', kind: 'OPENAI', status: 'active', baseUrl: null, name: 'p1' };
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
    const response = await handleAnthropicProxy({} as never, request(body), identity, () => scopeWith(proxy, anthropic));
    expect(response.status).toBe(200);
    const input = proxy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(input.clientEndpoint).toBe('anthropic');
    expect(input.rawBodyText).toBe(body);
  });
});
