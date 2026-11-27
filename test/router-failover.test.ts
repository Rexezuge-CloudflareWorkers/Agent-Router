import { describe, expect, it, vi } from 'vitest';
import { RouterService } from '@agent-router/backend-services/router';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { KeyCrypto } from '@agent-router/backend-services/provider';

const MASTER = 'test-master-key';

async function enc(secret: string): Promise<string> {
  return KeyCrypto.encrypt(secret, MASTER, 'provider-keys');
}

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    provider_id: 'p1',
    user_email: 'u@x.y',
    name: id,
    encrypted_key: '',
    key_hint: null,
    token_limit: null,
    request_limit: null,
    used_tokens: 0,
    used_requests: 0,
    reset_at: null,
    priority: 0,
    status: 'active',
    cooldown_until: null,
    consecutive_failures: 0,
    last_used_at: null,
    last_error: null,
    created_at: 1,
    updated_at: null,
    ...overrides,
  };
}

function makeService(keys: Array<ReturnType<typeof row>>, fetchImpl: typeof fetch, extraDeps: Record<string, unknown> = {}) {
  const events: string[] = [];
  const usage: Array<Record<string, unknown>> = [];
  const keyDAO = {
    listSelectableByProvider: async () => keys,
    getById: async (id: string) => keys.find((k) => k.id === id) ?? null,
    recordSuccess: async (id: string) => {
      events.push(`success:${id}`);
    },
    recordFailure: async (id: string) => {
      events.push(`failure:${id}`);
    },
    markDegraded: async (id: string) => {
      events.push(`degraded:${id}`);
    },
    markExhausted: async (id: string) => {
      events.push(`exhausted:${id}`);
    },
    database: { prepare: () => ({ bind: () => ({ run: async () => {} }) }) },
  };
  const env = { DB: {} as never, PROVIDER_KEYS_ENCRYPTION_SECRET: { get: async () => MASTER } };
  const svc = new RouterService(env, {
    providerDAO: () =>
      Promise.resolve({ getById: async () => ({ id: 'p1', user_email: 'u@x.y', userEmail: 'u@x.y', status: 'active' }) } as never),
    providerKeyDAO: () => Promise.resolve(keyDAO as never),
    usageDAO: () => Promise.resolve({ insert: async (r: Record<string, unknown>) => void usage.push(r) } as never),
    masterKey: async () => MASTER,
    config: AppConfiguration.fromEnv(env),
    fetchImpl,
    ...extraDeps,
  });
  return { svc, events, usage };
}

function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'content-type': 'application/json' } });
}

describe('RouterService failover', () => {
  it('proxies with the first key and records usage tokens', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('sk-1');
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    );
    const { svc, events, usage } = makeService([k1], fetchImpl as unknown as typeof fetch);
    const result = await svc.proxy({
      userEmail: 'u@x.y',
      gatewayKeyId: 'gw1',
      providerId: 'p1',
      providerKind: 'OPENAI',
      providerBaseUrl: 'https://api.openai.com/v1',
      upstreamPath: '/chat/completions',
      upstreamBody: { model: 'gpt-4o', messages: [] },
      upstreamModel: 'gpt-4o',
      bodyBytes: 100,
    });
    expect(result.status).toBe(200);
    expect(result.providerKeyId).toBe('k1');
    expect(result.promptTokens).toBe(10);
    expect(events).toContain('success:k1');
    expect(usage[0].total_tokens ?? (usage[0] as { totalTokens?: number }).totalTokens ?? 15).toBeDefined();
  });

  it('forwards a Responses body unchanged and meters buffered input/output tokens', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('sk-1');
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { id: 'resp_1', output_text: 'hi', output: [], usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 } }),
    );
    const { svc, events, usage } = makeService([k1], fetchImpl as unknown as typeof fetch);
    const body = {
      model: 'gpt-5',
      input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] }],
      instructions: 'Be brief',
      previous_response_id: 'resp_0',
      store: true,
      reasoning: { effort: 'low' },
    };
    const result = await svc.proxy({
      userEmail: 'u@x.y',
      gatewayKeyId: 'gw1',
      providerId: 'p1',
      providerKind: 'OPENAI',
      providerBaseUrl: 'https://api.openai.com/v1',
      upstreamPath: '/responses',
      upstreamBody: body,
      upstreamModel: 'gpt-5',
      bodyBytes: 100,
      rawBodyText: JSON.stringify(body),
    });

    expect(result.status).toBe(200);
    expect(result.promptTokens).toBe(12);
    expect(result.completionTokens).toBe(4);
    expect(result.estimated).toBe(false);
    expect(events).toContain('success:k1');
    expect(usage).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it('fails over from 429 to the next key', async () => {
    const k1 = row('k1', { priority: 0 });
    const k2 = row('k2', { priority: 1 });
    k1.encrypted_key = await enc('sk-1');
    k2.encrypted_key = await enc('sk-2');
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
      if (auth.includes('sk-1')) return jsonResponse(429, { error: { message: 'Rate limited' } });
      return jsonResponse(200, { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    });
    const { svc, events } = makeService([k1, k2], fetchImpl as unknown as typeof fetch);
    const result = await svc.proxy({
      userEmail: 'u@x.y',
      gatewayKeyId: 'gw1',
      providerId: 'p1',
      providerKind: 'OPENAI',
      providerBaseUrl: 'https://api.openai.com/v1',
      upstreamPath: '/chat/completions',
      upstreamBody: { model: 'gpt-4o', messages: [] },
      upstreamModel: 'gpt-4o',
      bodyBytes: 100,
    });
    expect(result.providerKeyId).toBe('k2');
    expect(events).toContain('degraded:k1');
    expect(events).not.toContain('failure:k1');
    expect(events).toContain('success:k2');
  });

  it('uses degraded keys only after active keys are exhausted', async () => {
    const k1 = row('k1', { priority: 0 });
    const k2 = row('k2', { priority: 1, status: 'degraded' });
    k1.encrypted_key = await enc('sk-1');
    k2.encrypted_key = await enc('sk-2');
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.authorization ?? '';
      if (auth.includes('sk-1')) return jsonResponse(429, { error: { message: 'Rate limited' } });
      return jsonResponse(200, { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
    });
    const { svc, events } = makeService([k1, k2], fetchImpl as unknown as typeof fetch);
    const result = await svc.proxy({
      userEmail: 'u@x.y',
      gatewayKeyId: 'gw1',
      providerId: 'p1',
      providerKind: 'OPENAI',
      providerBaseUrl: 'https://api.openai.com/v1',
      upstreamPath: '/chat/completions',
      upstreamBody: { model: 'gpt-4o', messages: [] },
      upstreamModel: 'gpt-4o',
      bodyBytes: 100,
    });
    expect(result.providerKeyId).toBe('k2');
    expect(events).toContain('degraded:k1');
    expect(events).toContain('success:k2');
  });

  it('returns 429 when every key is exhausted', async () => {
    const k1 = row('k1', { token_limit: 10, used_tokens: 10 });
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const { svc } = makeService([k1], fetchImpl as unknown as typeof fetch);
    await expect(
      svc.proxy({
        userEmail: 'u@x.y',
        gatewayKeyId: 'gw1',
        providerId: 'p1',
        providerKind: 'OPENAI',
        providerBaseUrl: 'https://api.openai.com/v1',
        upstreamPath: '/chat/completions',
        upstreamBody: { model: 'gpt-4o', messages: [] },
        upstreamModel: 'gpt-4o',
        bodyBytes: 10,
      }),
    ).rejects.toThrow(/exhausted/i);
  });

  it('includes the upstream 429 detail when every key is rate limited', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('sk-1');
    const fetchImpl = vi.fn(async () => jsonResponse(429, { error: { message: 'Account quota hit' } }));
    const { svc } = makeService([k1], fetchImpl as unknown as typeof fetch);
    await expect(
      svc.proxy({
        userEmail: 'u@x.y',
        gatewayKeyId: 'gw1',
        providerId: 'p1',
        providerKind: 'OPENAI',
        providerBaseUrl: 'https://api.openai.com/v1',
        upstreamPath: '/chat/completions',
        upstreamBody: { model: 'gpt-4o', messages: [] },
        upstreamModel: 'gpt-4o',
        bodyBytes: 10,
      }),
    ).rejects.toThrow(/Account quota hit/);
  });

  it('maps Codex HTML error pages to reconnect guidance', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('sk-1');
    const html = '<html><head><title>Just a moment...</title></head><body>Verify you are human</body></html>';
    const fetchImpl = vi.fn(async () => new Response(html, { status: 400, headers: { 'content-type': 'text/html' } }));
    const { svc, events } = makeService([k1], fetchImpl as unknown as typeof fetch);
    await expect(
      svc.proxy({
        userEmail: 'u@x.y',
        gatewayKeyId: 'gw1',
        providerId: 'p1',
        providerKind: 'OPENAI_CODEX',
        providerBaseUrl: 'https://chatgpt.com/backend-api/codex',
        upstreamPath: '/responses',
        upstreamBody: { model: 'gpt-5.5', input: 'hi' },
        upstreamModel: 'gpt-5.5',
        bodyBytes: 10,
      }),
    ).rejects.toThrow(/login page.*no ChatGPT account is linked/i);
    // Non-retryable: no failover cooldown recorded.
    expect(events).not.toContain('failure:k1');
  });

  it('surfaces non-retryable 4xx without failover', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('sk-1');
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: { message: 'Bad model' } }));
    const { svc, events } = makeService([k1], fetchImpl as unknown as typeof fetch);
    await expect(
      svc.proxy({
        userEmail: 'u@x.y',
        gatewayKeyId: 'gw1',
        providerId: 'p1',
        providerKind: 'OPENAI',
        providerBaseUrl: 'https://api.openai.com/v1',
        upstreamPath: '/chat/completions',
        upstreamBody: { model: 'nope', messages: [] },
        upstreamModel: 'nope',
        bodyBytes: 10,
      }),
    ).rejects.toThrow(/Bad model/);
    expect(events).not.toContain('failure:k1');
  });

  it('skips key cooldown when the client aborts a Command Code request', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('user_key');
    const controller = new AbortController();
    controller.abort();
    const commandCode = {
      ensureInitialized: async () => {},
      call: async () => {
        throw new DOMException('The operation was aborted', 'AbortError');
      },
    };
    const { svc, events } = makeService([k1], vi.fn() as unknown as typeof fetch, { commandCode });
    await expect(
      svc.proxy({
        userEmail: 'u@x.y',
        gatewayKeyId: 'gw1',
        providerId: 'p1',
        providerKind: 'COMMAND_CODE',
        providerBaseUrl: 'https://api.commandcode.ai',
        upstreamPath: '/alpha/generate',
        upstreamBody: { model: 'recursive/flint-v1.0:free', messages: [{ role: 'user', content: 'hi' }] },
        upstreamModel: 'recursive/flint-v1.0:free',
        bodyBytes: 10,
        clientEndpoint: 'chat',
        signal: controller.signal,
      }),
    ).rejects.toThrow(/aborted/i);
    expect(events).not.toContain('failure:k1');
  });

  it('disables a Command Code key at the failure threshold, matching the standard path', async () => {
    // consecutive_failures is one below KEY_MAX_CONSECUTIVE_FAILURES (10), so a
    // single retryable 502 crosses the threshold and must set status=disabled.
    const k1 = row('k1', { consecutive_failures: 9 });
    k1.encrypted_key = await enc('user_key');
    const events: string[] = [];
    const fetchImpl = vi.fn(async () => jsonResponse(200, {}));
    const keyDAO = {
      listSelectableByProvider: async () => [k1],
      getById: async () => k1,
      recordSuccess: async () => {},
      recordFailure: async (id: string) => void events.push(`failure:${id}`),
      markDegraded: async (id: string) => void events.push(`degraded:${id}`),
      markExhausted: async () => {},
      disable: async (id: string) => void events.push(`disabled:${id}`),
    };
    const env = { DB: {} as never, PROVIDER_KEYS_ENCRYPTION_SECRET: { get: async () => MASTER }, KEY_MAX_CONSECUTIVE_FAILURES: '10' };
    const commandCode = {
      ensureInitialized: async () => {},
      call: async () => ({ ok: false, status: 502, message: 'Upstream flaked', retryable: true, code: null }),
    };
    const svc = new RouterService(env, {
      providerDAO: () =>
        Promise.resolve({ getById: async () => ({ id: 'p1', user_email: 'u@x.y', userEmail: 'u@x.y', status: 'active' }) } as never),
      providerKeyDAO: () => Promise.resolve(keyDAO as never),
      usageDAO: () => Promise.resolve({ insert: async () => {} } as never),
      masterKey: async () => MASTER,
      config: AppConfiguration.fromEnv(env),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      commandCode: commandCode as never,
    });
    await expect(
      svc.proxy({
        userEmail: 'u@x.y',
        gatewayKeyId: 'gw1',
        providerId: 'p1',
        providerKind: 'COMMAND_CODE',
        providerBaseUrl: 'https://api.commandcode.ai',
        upstreamPath: '/alpha/generate',
        upstreamBody: { model: 'x', messages: [] },
        upstreamModel: 'x',
        bodyBytes: 10,
        clientEndpoint: 'chat',
      }),
    ).rejects.toThrow();
    expect(events).toContain('failure:k1');
    expect(events).toContain('disabled:k1');
  });

  it('does not cool a Command Code key when the upstream stream goes idle', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('user_key');
    const commandCode = {
      ensureInitialized: async () => {},
      call: async () => ({
        ok: false,
        status: 504,
        message: 'Upstream stream idle timeout: no data received for 120000ms',
        retryable: true,
        code: 'STREAM_IDLE_TIMEOUT',
      }),
    };
    const { svc, events } = makeService([k1], vi.fn() as unknown as typeof fetch, { commandCode });
    await expect(
      svc.proxy({
        userEmail: 'u@x.y',
        gatewayKeyId: 'gw1',
        providerId: 'p1',
        providerKind: 'COMMAND_CODE',
        providerBaseUrl: 'https://api.commandcode.ai',
        upstreamPath: '/alpha/generate',
        upstreamBody: { model: 'x', messages: [] },
        upstreamModel: 'x',
        bodyBytes: 10,
        clientEndpoint: 'chat',
        clientStream: true,
      }),
    ).rejects.toThrow(/idle timeout/);
    expect(events).not.toContain('failure:k1');
    expect(events).not.toContain('degraded:k1');
  });

  it('records a failed ledger row when a relayed stream ends idle', async () => {
    const k1 = row('k1');
    k1.encrypted_key = await enc('user_key');
    const commandCode = {
      ensureInitialized: async () => {},
      call: async () => ({
        ok: true,
        result: {
          bodyStream: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
          contentType: 'text/event-stream',
          promptTokens: 0,
          completionTokens: 0,
          estimated: true,
          usagePromise: Promise.resolve({ promptTokens: 0, completionTokens: 0, estimated: true, failed: true }),
        },
      }),
    };
    const { svc, events, usage } = makeService([k1], vi.fn() as unknown as typeof fetch, { commandCode });
    await svc.proxy({
      userEmail: 'u@x.y',
      gatewayKeyId: 'gw1',
      providerId: 'p1',
      providerKind: 'COMMAND_CODE',
      providerBaseUrl: 'https://api.commandcode.ai',
      upstreamPath: '/alpha/generate',
      upstreamBody: { model: 'x', messages: [] },
      upstreamModel: 'x',
      bodyBytes: 10,
      clientEndpoint: 'chat',
      clientStream: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).not.toContain('success:k1');
    expect(usage).toHaveLength(1);
    expect(usage[0].statusCode).toBe(504);
  });
});
