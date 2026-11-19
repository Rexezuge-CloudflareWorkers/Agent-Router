import type { Container } from '@agent-router/backend-runtime/di';
import type { ProviderKind } from '@agent-router/shared';
import { NotFoundError, RateLimitedError, ServiceError } from '@rexezuge/errors';
import { Tokens, createRequestScope } from '../composition/index';

type ProxyOperationsEnv = Parameters<typeof createRequestScope>[0];
type ProxyScopeFactory = (env: ProxyOperationsEnv) => Container;

interface ProxyIdentity {
  userEmail: string;
  gatewayKeyId: string;
}

interface ProxyCallResult {
  status: number;
  bodyText?: string;
  bodyStream?: ReadableStream<Uint8Array>;
  contentType: string | null;
  providerKeyId: string;
}

function inferKind(model: unknown): ProviderKind | null {
  if (typeof model !== 'string') return null;
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 'ANTHROPIC';
  if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) return 'GEMINI';
  if (
    m.startsWith('deepseek/') ||
    m.startsWith('moonshotai/') ||
    m.startsWith('zai-org/') ||
    m.startsWith('minimaxai/') ||
    m.startsWith('qwen/') ||
    m.startsWith('stepfun/') ||
    m.startsWith('xiaomi/') ||
    m.startsWith('google/gemini-')
  ) {
    return 'COMMAND_CODE';
  }
  return m.startsWith('gpt-') ||
    m.startsWith('o1-') ||
    m.startsWith('o3-') ||
    m.startsWith('o4-') ||
    m.startsWith('text-embedding-') ||
    m.startsWith('whisper-') ||
    m.startsWith('dall-e-') ||
    m.startsWith('tts-')
    ? 'OPENAI'
    : null;
}

async function resolveProviderId(
  scope: Container,
  userEmail: string,
  opts: { kind: ProviderKind | null; explicitId: string | null },
): Promise<{ id: string; kind: ProviderKind; baseUrl: string | null }> {
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
    // Anthropic-shaped traffic can be served by Command Code (it speaks the
    // Messages API), so fall back when no Anthropic provider is configured.
    // Unknown model prefixes are also common for Command Code's namespaced
    // models, so use the only active Command Code provider instead of failing.
    if (opts.kind === 'OPENAI' || opts.kind === 'ANTHROPIC') {
      const commandCode = providers.find((p) => p.kind === 'COMMAND_CODE');
      if (commandCode) return { id: commandCode.id, kind: commandCode.kind, baseUrl: commandCode.baseUrl };
    }
    throw new NotFoundError(`No active ${opts.kind} provider. Add one under /user/providers.`);
  }
  const fallback = providers[0];
  if (!fallback) throw new NotFoundError('No providers configured. Add one under /user/providers.');
  return { id: fallback.id, kind: fallback.kind, baseUrl: fallback.baseUrl };
}

function errorResponse(error: unknown): Response {
  if (error instanceof RateLimitedError) {
    return Response.json(
      { error: { message: error.message, type: 'rate_limit_exceeded', code: 'all_keys_exhausted' } },
      { status: 429, headers: { 'Retry-After': '30' } },
    );
  }
  if (error instanceof ServiceError) {
    const code = error.status;
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

function incomingHeaders(request: Request): Record<string, string | undefined> {
  return {
    'x-session-id': request.headers.get('x-session-id') ?? undefined,
    'x-claude-code-session-id': request.headers.get('x-claude-code-session-id') ?? undefined,
    session_id: request.headers.get('session_id') ?? undefined,
    'x-cmd-zdr': request.headers.get('x-cmd-zdr') ?? undefined,
    'x-api-key': request.headers.get('x-api-key') ?? undefined,
  };
}

function proxyResponse(result: ProxyCallResult): Response {
  const headers: Record<string, string> = {
    'content-type': result.contentType ?? 'application/json',
    'x-provider-key-id': result.providerKeyId,
  };
  return new Response(result.bodyStream ?? result.bodyText ?? '', { status: result.status, headers });
}

interface ParsedBody {
  text: string;
  body: Record<string, unknown>;
  bodyBytes: number;
}

function tooLarge(): Response {
  return Response.json({ error: { message: 'Request body too large', type: 'invalid_request_error' } }, { status: 413 });
}

async function readJsonBody(request: Request, maxBytes: number): Promise<ParsedBody | Response> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return Response.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, { status: 400 });
  }
  if (bytes.byteLength > maxBytes) return tooLarge();
  const text = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return Response.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, { status: 400 });
  }
  return !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    ? Response.json({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }, { status: 400 })
    : { text, body: parsed as Record<string, unknown>, bodyBytes: bytes.byteLength };
}

function bodyLimit(scope: Container): number {
  const config = scope.get(Tokens.AppConfig);
  return Math.max(config.getProxyMaxBodyBytes(), config.getCommandCodeMaxBodyBytes());
}

async function handleOpenAiProxy(
  env: ProxyOperationsEnv,
  request: Request,
  upstreamPath: string,
  identity: ProxyIdentity,
  scopeFactory: ProxyScopeFactory = createRequestScope,
): Promise<Response> {
  const scope = scopeFactory(env);
  const parsed = await readJsonBody(request, bodyLimit(scope));
  if (parsed instanceof Response) return parsed;
  const body = parsed.body;

  const explicitId = request.headers.get('x-provider-id')?.trim() || null;
  let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
  try {
    provider = await resolveProviderId(scope, identity.userEmail, { kind: inferKind(body.model) ?? 'OPENAI', explicitId });
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
          message:
            'Codex OAuth providers only support POST /v1/responses with a Codex model; add an OPENAI provider for chat completions or embeddings',
          type: 'invalid_request_error',
        },
      },
      { status: 400 },
    );
  }
  // Command Code only serves chat/responses traffic, not embeddings.
  if (upstreamPath === '/embeddings' && provider.kind === 'COMMAND_CODE') {
    return Response.json(
      { error: { message: 'Command Code providers do not support embeddings', type: 'invalid_request_error' } },
      { status: 400 },
    );
  }
  try {
    const router = scope.get(Tokens.RouterService);
    const result = await router.proxy({
      userEmail: identity.userEmail,
      gatewayKeyId: identity.gatewayKeyId,
      providerId: provider.id,
      providerKind: provider.kind,
      providerBaseUrl: provider.baseUrl,
      upstreamPath,
      upstreamBody: body,
      upstreamModel: typeof body.model === 'string' ? body.model : null,
      bodyBytes: parsed.bodyBytes,
      rawBodyText: parsed.text,
      clientEndpoint: upstreamPath === '/responses' ? 'responses' : 'chat',
      clientStream: body.stream === true,
      incomingHeaders: incomingHeaders(request),
      signal: request.signal,
    });
    return proxyResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleAnthropicProxy(
  env: ProxyOperationsEnv,
  request: Request,
  identity: ProxyIdentity,
  scopeFactory: ProxyScopeFactory = createRequestScope,
): Promise<Response> {
  const scope = scopeFactory(env);
  const parsed = await readJsonBody(request, bodyLimit(scope));
  if (parsed instanceof Response) return parsed;
  const body = parsed.body;

  const explicitId = request.headers.get('x-provider-id')?.trim() || null;
  let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
  try {
    provider = await resolveProviderId(scope, identity.userEmail, { kind: 'ANTHROPIC', explicitId });
  } catch (error) {
    return errorResponse(error);
  }
  if (provider.kind !== 'ANTHROPIC' && provider.kind !== 'COMMAND_CODE') {
    return Response.json(
      { error: { message: 'Resolved provider is not Anthropic; set x-provider-id', type: 'invalid_request_error' } },
      { status: 400 },
    );
  }
  try {
    const router = scope.get(Tokens.RouterService);
    const result = await router.proxy({
      userEmail: identity.userEmail,
      gatewayKeyId: identity.gatewayKeyId,
      providerId: provider.id,
      providerKind: provider.kind,
      providerBaseUrl: provider.baseUrl,
      upstreamPath: '/v1/messages',
      upstreamBody: body,
      upstreamModel: typeof body.model === 'string' ? body.model : null,
      bodyBytes: parsed.bodyBytes,
      rawBodyText: parsed.text,
      clientEndpoint: 'anthropic',
      clientStream: body.stream === true,
      incomingHeaders: incomingHeaders(request),
      signal: request.signal,
    });
    return proxyResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleGeminiProxy(
  env: ProxyOperationsEnv,
  request: Request,
  action: string,
  identity: ProxyIdentity,
  scopeFactory: ProxyScopeFactory = createRequestScope,
): Promise<Response> {
  const match = /^(models\/[^:]+):(generateContent|streamGenerateContent)$/.exec(action);
  if (!match) {
    return Response.json(
      { error: { message: 'Path must be /gemini/v1beta/models/<model>:generateContent', type: 'invalid_request_error' } },
      { status: 404 },
    );
  }
  const scope = scopeFactory(env);
  const parsed = await readJsonBody(request, bodyLimit(scope));
  if (parsed instanceof Response) return parsed;
  const body = parsed.body;

  const explicitId = request.headers.get('x-provider-id')?.trim() || null;
  let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
  try {
    provider = await resolveProviderId(scope, identity.userEmail, { kind: 'GEMINI', explicitId });
  } catch (error) {
    return errorResponse(error);
  }
  if (provider.kind !== 'GEMINI') {
    return Response.json(
      { error: { message: 'Resolved provider is not Gemini; set x-provider-id', type: 'invalid_request_error' } },
      { status: 400 },
    );
  }
  try {
    const router = scope.get(Tokens.RouterService);
    const result = await router.proxy({
      userEmail: identity.userEmail,
      gatewayKeyId: identity.gatewayKeyId,
      providerId: provider.id,
      providerKind: 'GEMINI',
      providerBaseUrl: provider.baseUrl,
      upstreamPath: `/v1beta/${match[1]}:${match[2]}`,
      upstreamBody: body,
      upstreamModel: match[1],
      bodyBytes: parsed.bodyBytes,
      rawBodyText: parsed.text,
    });
    return new Response(result.bodyText, {
      status: result.status,
      headers: { 'content-type': 'application/json', 'x-provider-key-id': result.providerKeyId },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function listCommandCodeModels(
  env: ProxyOperationsEnv,
  userEmail: string,
  explicitId: string | null,
  scopeFactory: ProxyScopeFactory = createRequestScope,
): Promise<{ id: string; name: string; providerId: string }[]> {
  const scope = scopeFactory(env);
  const providers = await scope.get(Tokens.ProviderService).listProviders(userEmail);
  const provider = providers.find(
    explicitId ? (p) => p.id === explicitId && p.kind === 'COMMAND_CODE' : (p) => p.status === 'active' && p.kind === 'COMMAND_CODE',
  );
  if (!provider) return [];
  const keyService = scope.get(Tokens.ProviderKeyService);
  const keys = await keyService.listKeys(provider.id, userEmail).catch(() => []);
  const key = keys.find((k) => k.status === 'active') ?? keys[0];
  if (!key) return [];
  const secret = await keyService.decryptSecret(provider.id, key.id, userEmail).catch(() => null);
  if (!secret) return [];
  const models = await scope.get(Tokens.CommandCodeService).listModels(provider.id, secret, provider.baseUrl);
  return models.map((model) => ({ id: model.id, name: model.name, providerId: provider.id }));
}

export { errorResponse, handleAnthropicProxy, handleGeminiProxy, handleOpenAiProxy, inferKind, listCommandCodeModels, resolveProviderId };
export type { ProxyIdentity, ProxyOperationsEnv, ProxyScopeFactory };
