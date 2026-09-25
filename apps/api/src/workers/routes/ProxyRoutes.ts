import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { MiddlewareHandlers } from '@/middleware';
import type { ProviderKind } from '@agent-router/shared';
import { ExceededLimitError, NotFoundError, ServiceError } from '@agent-router/backend-errors';

type ProxyApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function inferKind(model: unknown): ProviderKind | null {
  if (typeof model !== 'string') return null;
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 'ANTHROPIC';
  if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) return 'GEMINI';
  return m.startsWith('gpt-') ||
    m.startsWith('o1-') ||
    m.startsWith('o3-') ||
    m.startsWith('o4-') ||
    m.startsWith('text-embedding-') ||
    m.startsWith('whisper-') ||
    m.startsWith('dall-e-') ||
    m.startsWith('tts-') ? 'OPENAI' : null;
}

async function resolveProviderId(
  env: Env,
  userEmail: string,
  opts: { kind: ProviderKind | null; explicitId: string | null },
): Promise<{ id: string; kind: ProviderKind; baseUrl: string | null }> {
  const scope = createRequestScope(env);
  const svc = scope.get(Tokens.ProviderService);
  const all = await svc.listProviders(userEmail);
  const providers = all.filter((p) => p.status === 'active');
  if (opts.explicitId) {
    const found = providers.find((p) => p.id === opts.explicitId);
    if (!found) throw new NotFoundError('Provider not found');
    return { id: found.id, kind: found.kind, baseUrl: found.baseUrl };
  }
  if (opts.kind) {
    const found = providers.find((p) => p.kind === opts.kind);
    if (found) return { id: found.id, kind: found.kind, baseUrl: found.baseUrl };
    // Responses requests fall back to Codex OAuth when no static OpenAI
    // provider exists (chat/embeddings via Codex are rejected below with
    // guidance — the Codex backend only serves the Responses API).
    if (opts.kind === 'OPENAI') {
      const codex = providers.find((p) => p.kind === 'OPENAI_CODEX');
      if (codex) return { id: codex.id, kind: codex.kind, baseUrl: codex.baseUrl };
    }
    throw new NotFoundError(`No active ${opts.kind} provider. Add one under /user/providers.`);
  }
  const fallback = providers[0];
  if (!fallback) throw new NotFoundError('No providers configured. Add one under /user/providers.');
  return { id: fallback.id, kind: fallback.kind, baseUrl: fallback.baseUrl };
}

function errorResponse(error: unknown): Response {
  if (error instanceof ExceededLimitError) {
    return Response.json(
      { error: { message: error.message, type: 'rate_limit_exceeded', code: 'all_keys_exhausted' } },
      { status: 429, headers: { 'Retry-After': '30' } },
    );
  }
  if (error instanceof ServiceError) {
    const code = error.getErrorCode();
    if (code === 400) return Response.json({ error: { message: error.message, type: 'invalid_request_error' } }, { status: 400 });
    if (code === 404) return Response.json({ error: { message: error.message, type: 'not_found' } }, { status: 404 });
  }
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    const message = error instanceof Error ? error.message : 'Upstream error';
    return Response.json({ error: { message, type: 'upstream_error' } }, { status: statusCode });
  }
  const message = error instanceof Error ? error.message : 'Internal error';
  const status = message.includes('too large') ? 413 : 500;
  return Response.json({ error: { message: status === 500 ? 'Internal error' : message, type: 'internal_error' } }, { status });
}

type ProxyContext = { req: { json(): Promise<unknown>; header(name: string): string | undefined }; env: Env };

async function proxyOpenAI(c: ProxyContext, upstreamPath: string): Promise<Response> {
  const gateway = await MiddlewareHandlers.requireGateway(c as never);
  if (gateway instanceof Response) return gateway;
  const rawBody = await c.req.json().catch(() => null);
  const body = rawBody as { model?: unknown } | null;
  if (!body || typeof body !== 'object')
    return Response.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, { status: 400 });
  const explicitId = c.req.header('x-provider-id')?.trim() || null;
  let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
  try {
    provider = await resolveProviderId(c.env, gateway.userEmail, { kind: inferKind(body.model) ?? 'OPENAI', explicitId });
  } catch (error) {
    return errorResponse(error);
  }
  if (provider.kind === 'ANTHROPIC' || provider.kind === 'GEMINI') {
    const suffix = provider.kind === 'ANTHROPIC' ? 'anthropic' : 'gemini';
    return Response.json(
      {
        error: {
          message: `Model routes to ${provider.kind}; use the/${suffix}/* endpoint or set x-provider-id`,
          type: 'invalid_request_error',
        },
      },
      { status: 400 },
    );
  }
  // Codex OAuth (ChatGPT subscription) tokens are honored by the Codex
  // backend, which serves the Responses API — not platform chat/embeddings.
  // Fail fast with guidance instead of 429ing upstream and cooling the key.
  if (upstreamPath !== '/responses' && provider.kind === 'OPENAI_CODEX') {
    return Response.json(
      {
        error: {
          message: 'Codex OAuth providers only support POST /v1/responses with a Codex model; add an OPENAI provider for chat completions or embeddings',
          type: 'invalid_request_error',
        },
      },
      { status: 400 },
    );
  }
  const bodyText = JSON.stringify(body);
  try {
    const scope = createRequestScope(c.env);
    const router = scope.get(Tokens.RouterService);
    const result = await router.proxy({
      userEmail: gateway.userEmail,
      gatewayKeyId: gateway.keyId,
      providerId: provider.id,
      providerKind: provider.kind,
      providerBaseUrl: provider.baseUrl,
      upstreamPath,
      upstreamBody: body,
      upstreamModel: typeof body.model === 'string' ? body.model : null,
      bodyBytes: new TextEncoder().encode(bodyText).length,
    });
    return new Response(result.bodyText, {
      status: result.status,
      headers: { 'content-type': result.contentType ?? 'application/json', 'x-provider-key-id': result.providerKeyId },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function registerProxyRoutes(app: ProxyApp): void {
  app.post('/v1/chat/completions', (c) => proxyOpenAI(c, '/chat/completions'));
  app.post('/v1/embeddings', (c) => proxyOpenAI(c, '/embeddings'));
  app.post('/v1/responses', (c) => proxyOpenAI(c, '/responses'));
  app.get('/v1/models', async (c) => {
    const gateway = await MiddlewareHandlers.requireGateway(c as never);
    if (gateway instanceof Response) return gateway;
    try {
      const scope = createRequestScope(c.env);
      const providers = await scope.get(Tokens.ProviderService).listProviders(gateway.userEmail);
      return c.json({
        object: 'list',
        data: providers
          .filter((p) => p.status === 'active')
          .map((p) => ({ id: p.name, object: 'model', owned_by: p.kind.toLowerCase(), provider_id: p.id, kind: p.kind })),
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post('/anthropic/v1/messages', async (c) => {
    const gateway = await MiddlewareHandlers.requireGateway(c as never);
    if (gateway instanceof Response) return gateway;
    const rawBody = await c.req.json().catch(() => null);
    const body = rawBody as { model?: unknown } | null;
    if (!body || typeof body !== 'object')
      return Response.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, { status: 400 });
    const explicitId = c.req.header('x-provider-id')?.trim() || null;
    let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
    try {
      provider = await resolveProviderId(c.env, gateway.userEmail, { kind: 'ANTHROPIC', explicitId });
    } catch (error) {
      return errorResponse(error);
    }
    if (provider.kind !== 'ANTHROPIC') {
      return Response.json(
        { error: { message: 'Resolved provider is not Anthropic; set x-provider-id', type: 'invalid_request_error' } },
        { status: 400 },
      );
    }
    const bodyText = JSON.stringify(body);
    try {
      const scope = createRequestScope(c.env);
      const router = scope.get(Tokens.RouterService);
      const result = await router.proxy({
        userEmail: gateway.userEmail,
        gatewayKeyId: gateway.keyId,
        providerId: provider.id,
        providerKind: 'ANTHROPIC',
        providerBaseUrl: provider.baseUrl,
        upstreamPath: '/v1/messages',
        upstreamBody: body,
        upstreamModel: typeof body.model === 'string' ? body.model : null,
        bodyBytes: new TextEncoder().encode(bodyText).length,
      });
      return new Response(result.bodyText, {
        status: result.status,
        headers: { 'content-type': 'application/json', 'x-provider-key-id': result.providerKeyId },
      });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post('/gemini/v1beta/models/:action', async (c) => {
    const gateway = await MiddlewareHandlers.requireGateway(c as never);
    if (gateway instanceof Response) return gateway;
    const action = c.req.param('action');
    const match = /^(models\/[^:]+):(generateContent|streamGenerateContent)$/.exec(action ?? '');
    if (!match)
      return Response.json(
        { error: { message: 'Path must be /gemini/v1beta/models/<model>:generateContent', type: 'invalid_request_error' } },
        { status: 404 },
      );
    const rawGeminiBody = await c.req.json().catch(() => ({}));
    const body = rawGeminiBody as Record<string, unknown>;
    const explicitId = c.req.header('x-provider-id')?.trim() || null;
    let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
    try {
      provider = await resolveProviderId(c.env, gateway.userEmail, { kind: 'GEMINI', explicitId });
    } catch (error) {
      return errorResponse(error);
    }
    if (provider.kind !== 'GEMINI') {
      return Response.json(
        { error: { message: 'Resolved provider is not Gemini; set x-provider-id', type: 'invalid_request_error' } },
        { status: 400 },
      );
    }
    const bodyText = JSON.stringify(body);
    try {
      const scope = createRequestScope(c.env);
      const router = scope.get(Tokens.RouterService);
      const result = await router.proxy({
        userEmail: gateway.userEmail,
        gatewayKeyId: gateway.keyId,
        providerId: provider.id,
        providerKind: 'GEMINI',
        providerBaseUrl: provider.baseUrl,
        upstreamPath: `/v1beta/${match[1]}:${match[2]}`,
        upstreamBody: body,
        upstreamModel: match[1],
        bodyBytes: new TextEncoder().encode(bodyText).length,
      });
      return new Response(result.bodyText, {
        status: result.status,
        headers: { 'content-type': 'application/json', 'x-provider-key-id': result.providerKeyId },
      });
    } catch (error) {
      return errorResponse(error);
    }
  });
}

export { registerProxyRoutes };
