import { describe, expect, it, vi } from 'vitest';
import { forwardToProxyGateway } from '@/workers/routes/ProxyRoutes';

interface FakeContext {
  env: unknown;
  req: { raw: Request; header(name: string): string | undefined };
  get(key: string): string | undefined;
  json(body: unknown, status: number): Response;
}

function context(raw: Request, gateway: { userEmail: string; keyId: string } | null, env: unknown): FakeContext {
  return {
    env,
    req: { raw, header: (name: string) => raw.headers.get(name) ?? undefined },
    get: (key: string) => {
      if (!gateway) return undefined;
      if (key === 'GatewayUserEmail') return gateway.userEmail;
      if (key === 'GatewayKeyId') return gateway.keyId;
      return undefined;
    },
    json: (body: unknown, status: number) => Response.json(body, { status }),
  };
}

function gatewayEnv(fetch: (request: Request) => Promise<Response>, onShard?: (name: string) => void): unknown {
  return {
    PROXY_GATEWAY: {
      idFromName: (name: string) => {
        onShard?.(name);
        return name;
      },
      get: () => ({ fetch }),
    },
  };
}

describe('proxy forwarding', () => {
  it('forwards to the per-key shard and overwrites spoofed identity headers', async () => {
    const raw = new Request('https://agent-router.test/v1/responses', {
      method: 'POST',
      body: '{"a":1}',
      headers: {
        'content-type': 'application/json',
        'x-agent-router-user-email': 'attacker@x.y',
        'x-agent-router-gateway-key': 'stolen',
      },
    });
    let shard = '';
    const captured: Array<{ email: string | null; key: string | null; body: string }> = [];
    const env = gatewayEnv(
      async (request) => {
        captured.push({
          email: request.headers.get('x-agent-router-user-email'),
          key: request.headers.get('x-agent-router-gateway-key'),
          body: await request.text(),
        });
        return new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } });
      },
      (name) => {
        shard = name;
      },
    );

    const response = await forwardToProxyGateway(context(raw, { userEmail: 'u@x.y', keyId: 'k1' }, env) as never);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(shard).toBe('key:k1');
    expect(captured[0]).toEqual({ email: 'u@x.y', key: 'k1', body: '{"a":1}' });
  });

  it('preserves the streamed response body', async () => {
    const raw = new Request('https://agent-router.test/v1/responses', { method: 'POST', body: '{}' });
    const chunk = new TextEncoder().encode('data: one\n\n');
    const env = gatewayEnv(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        ),
    );

    const response = await forwardToProxyGateway(context(raw, { userEmail: 'u@x.y', keyId: 'k1' }, env) as never);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(chunk);
  });

  it('answers 503 when the durable object cannot be reached', async () => {
    const raw = new Request('https://agent-router.test/v1/responses', { method: 'POST', body: '{}' });
    const env = gatewayEnv(async () => {
      throw new Error('overloaded');
    });

    const response = await forwardToProxyGateway(context(raw, { userEmail: 'u@x.y', keyId: 'k1' }, env) as never);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(await response.json()).toEqual({ error: { message: 'Proxy gateway unavailable', type: 'upstream_error' } });
  });

  it('requires a gateway key before forwarding', async () => {
    const raw = new Request('https://agent-router.test/v1/responses', { method: 'POST', body: '{}' });
    const fetch = vi.fn();
    const response = await forwardToProxyGateway(context(raw, null, gatewayEnv(fetch)) as never);
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
