import type { Container } from '@agent-router/backend-runtime/di';
import type { ProviderKind } from '@agent-router/shared';
import { RateLimitedError, ServiceError } from '@rexezuge/errors';
import { Tokens, createRequestScope } from '../composition/index';
import { applyPeakPolicy } from './peakPolicy';
import { inferKind, nativeSearchExclusions, resolveProviderId } from './providerResolution';

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

/**
OpenAI-shaped error envelope, the one shape every proxy client parses.
*/
function jsonError(message: string, type: string, status: number, headers?: Record<string, string>): Response {
  return Response.json({ error: { message, type } }, { status, ...(headers && { headers }) });
}

function errorResponse(error: unknown): Response {
  if (error instanceof RateLimitedError) {
    return jsonError(error.message, 'rate_limit_exceeded', 429, { 'Retry-After': '30' });
  }
  if (error instanceof ServiceError) {
    if (error.status === 400) return jsonError(error.message, 'invalid_request_error', 400);
    if (error.status === 404) return jsonError(error.message, 'not_found', 404);
    if (error.expose && error.status < 600) return jsonError(error.message, 'upstream_error', error.status);
  }
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 600) {
    const message = error instanceof Error ? error.message : 'Upstream error';
    return jsonError(message, 'upstream_error', statusCode);
  }
  const message = error instanceof Error ? error.message : 'Internal error';
  const status = message.includes('too large') ? 413 : 500;
  return jsonError(status === 500 ? 'Internal error' : message, 'internal_error', status);
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

function proxyResponse(result: ProxyCallResult, contentType = result.contentType): Response {
  const headers: Record<string, string> = {
    'content-type': contentType ?? 'application/json',
    'x-provider-key-id': result.providerKeyId,
  };
  return new Response(result.bodyStream ?? result.bodyText ?? '', { status: result.status, headers });
}

interface ParsedBody {
  text: string;
  body: Record<string, unknown>;
  bodyBytes: number;
}

async function readJsonBody(request: Request, maxBytes: number): Promise<ParsedBody | Response> {
  const declared = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    return jsonError('Request body too large', 'invalid_request_error', 413);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await request.arrayBuffer());
  } catch {
    return jsonError('Invalid JSON body', 'invalid_request_error', 400);
  }
  if (bytes.byteLength > maxBytes) return jsonError('Request body too large', 'invalid_request_error', 413);
  const text = new TextDecoder().decode(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return jsonError('Invalid JSON body', 'invalid_request_error', 400);
  }
  return !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    ? jsonError('Invalid JSON body', 'invalid_request_error', 400)
    : { text, body: parsed as Record<string, unknown>, bodyBytes: bytes.byteLength };
}

function bodyLimit(scope: Container): number {
  const config = scope.get(Tokens.AppConfig);
  return Math.max(config.getProxyMaxBodyBytes(), config.getCommandCodeMaxBodyBytes());
}

function readProviderHeader(request: Request): string | null {
  return request.headers.get('x-provider-id')?.trim() || null;
}

/**
Shared request fields passed to `RouterService.proxy`.
*/
interface ProxyEnvelope {
  userEmail: string;
  gatewayKeyId: string;
  providerId: string;
  providerKind: ProviderKind;
  providerBaseUrl: string | null;
  upstreamModel: string | null;
  bodyBytes: number;
  rawBodyText: string;
  clientStream: boolean;
  incomingHeaders: Record<string, string | undefined>;
  signal: AbortSignal;
}

/**
Resolves the provider for a proxy request and returns its router envelope.
*/
function envelopeFor(
  provider: { id: string; kind: ProviderKind; baseUrl: string | null },
  request: Request,
  identity: ProxyIdentity,
  body: Record<string, unknown>,
  parsed: ParsedBody,
  upstreamModel: string | null,
): ProxyEnvelope {
  return {
    userEmail: identity.userEmail,
    gatewayKeyId: identity.gatewayKeyId,
    providerId: provider.id,
    providerKind: provider.kind,
    providerBaseUrl: provider.baseUrl,
    upstreamModel,
    bodyBytes: parsed.bodyBytes,
    rawBodyText: parsed.text,
    clientStream: body.stream === true,
    incomingHeaders: incomingHeaders(request),
    signal: request.signal,
  };
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

  const decision = await applyPeakPolicy(scope, identity.gatewayKeyId, typeof body.model === 'string' ? body.model : null);
  if (decision.action === 'reject') return decision.response;
  if (decision.action === 'rewrite') body.model = decision.model;

  let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
  try {
    provider = await resolveProviderId(scope, identity.userEmail, {
      kind: inferKind(body.model) ?? 'OPENAI',
      explicitId: readProviderHeader(request),
      excludeKinds: await nativeSearchExclusions(scope, identity.userEmail),
    });
  } catch (error) {
    return errorResponse(error);
  }
  if (provider.kind === 'ANTHROPIC' || provider.kind === 'GEMINI') {
    const suffix = provider.kind === 'ANTHROPIC' ? 'anthropic' : 'gemini';
    return jsonError(`Model routes to ${provider.kind}; use the/${suffix}/* endpoint or set x-provider-id`, 'invalid_request_error', 400);
  }
  // Codex OAuth (ChatGPT subscription) tokens are honored by the Codex
  // backend, which serves the Responses API — not platform chat/embeddings.
  // Fail fast with guidance instead of 429ing upstream and cooling the key.
  if (upstreamPath !== '/responses' && provider.kind === 'OPENAI_CODEX') {
    return jsonError(
      'Codex OAuth providers only support POST /v1/responses with a Codex model; add an OPENAI provider for chat completions or embeddings',
      'invalid_request_error',
      400,
    );
  }
  // Command Code only serves chat/responses traffic, not embeddings.
  if (upstreamPath === '/embeddings' && provider.kind === 'COMMAND_CODE') {
    return jsonError('Command Code providers do not support embeddings', 'invalid_request_error', 400);
  }
  try {
    const result = await scope.get(Tokens.WebSearchRoutingService).proxy(
      {
        ...envelopeFor(provider, request, identity, body, parsed, typeof body.model === 'string' ? body.model : null),
        upstreamPath,
        upstreamBody: body,
        clientEndpoint: upstreamPath === '/responses' ? 'responses' : 'chat',
      },
      upstreamPath === '/responses' ? 'responses' : 'chat',
    );
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

  // The Anthropic surface also accepts Command Code providers, so a rewritten
  // fallback model (e.g. deepseek/* -> moonshotai/*) still routes correctly.
  const decision = await applyPeakPolicy(scope, identity.gatewayKeyId, typeof body.model === 'string' ? body.model : null);
  if (decision.action === 'reject') return decision.response;
  if (decision.action === 'rewrite') body.model = decision.model;

  let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
  try {
    provider = await resolveProviderId(scope, identity.userEmail, {
      kind: 'ANTHROPIC',
      explicitId: readProviderHeader(request),
      excludeKinds: await nativeSearchExclusions(scope, identity.userEmail),
    });
  } catch (error) {
    return errorResponse(error);
  }
  if (provider.kind !== 'ANTHROPIC' && provider.kind !== 'COMMAND_CODE') {
    return jsonError('Resolved provider is not Anthropic; set x-provider-id', 'invalid_request_error', 400);
  }
  try {
    const result = await scope.get(Tokens.WebSearchRoutingService).proxy(
      {
        ...envelopeFor(provider, request, identity, body, parsed, typeof body.model === 'string' ? body.model : null),
        upstreamPath: '/v1/messages',
        upstreamBody: body,
        clientEndpoint: 'anthropic',
      },
      'anthropic',
    );
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
    return jsonError('Path must be /gemini/v1beta/models/<model>:generateContent', 'invalid_request_error', 404);
  }
  const scope = scopeFactory(env);
  const parsed = await readJsonBody(request, bodyLimit(scope));
  if (parsed instanceof Response) return parsed;
  const body = parsed.body;

  // Gemini carries the model in the path, not the body. A fallback used here
  // must itself be a Gemini model, since only a GEMINI provider can serve it.
  let model = match[1];
  const decision = await applyPeakPolicy(scope, identity.gatewayKeyId, model.replace(/^models\//, ''));
  if (decision.action === 'reject') return decision.response;
  if (decision.action === 'rewrite') {
    model = decision.model;
    if (typeof body.model === 'string') body.model = decision.model;
  }

  let provider: { id: string; kind: ProviderKind; baseUrl: string | null };
  try {
    provider = await resolveProviderId(scope, identity.userEmail, {
      kind: 'GEMINI',
      explicitId: readProviderHeader(request),
      excludeKinds: await nativeSearchExclusions(scope, identity.userEmail),
    });
  } catch (error) {
    return errorResponse(error);
  }
  if (provider.kind !== 'GEMINI') {
    return jsonError('Resolved provider is not Gemini; set x-provider-id', 'invalid_request_error', 400);
  }
  try {
    const result = await scope.get(Tokens.WebSearchRoutingService).proxy(
      {
        ...envelopeFor(provider, request, identity, body, parsed, model),
        upstreamPath: `/v1beta/${model}:${match[2]}`,
        upstreamBody: body,
      },
      'gemini',
    );
    // Gemini responses are always JSON; relay both buffered and streaming
    // bodies through the shared path rather than dropping a stream here.
    return proxyResponse(result, 'application/json');
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

export { errorResponse, handleAnthropicProxy, handleGeminiProxy, handleOpenAiProxy, listCommandCodeModels };
export type { ProxyIdentity, ProxyOperationsEnv, ProxyScopeFactory };

export { inferKind, resolveProviderId } from './providerResolution';
