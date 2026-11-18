import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { errorResponse, listCommandCodeModels } from '@agent-router/backend-services/proxy';
import { MiddlewareHandlers } from '@/middleware';

type ProxyApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

type ProxyContext = {
  req: {
    header(name: string): string | undefined;
    raw: Request;
  };
  env: Env;
};

const IDENTITY_EMAIL_HEADER = 'x-agent-router-user-email';
const IDENTITY_KEY_HEADER = 'x-agent-router-gateway-key';

/**
Hands a proxy request to the gateway Durable Object.

Authentication, rate limiting and scope creation stay on the worker; the
body is never read here. The identity headers are written after the clone so
a client-supplied value can never impersonate another gateway key.
*/
async function forwardToProxyGateway(c: ProxyContext): Promise<Response> {
  const gateway = await MiddlewareHandlers.requireGateway(c as never);
  if (gateway instanceof Response) return gateway;

  // A Request built from another does not inherit its abort signal, so bridge
  // the client disconnect through explicitly: the DO (and the upstream call it
  // owns) must not keep generating after the caller is gone.
  const abort = new AbortController();
  const clientSignal = c.req.raw.signal;
  if (clientSignal.aborted) abort.abort(clientSignal.reason);
  else clientSignal.addEventListener('abort', () => abort.abort(clientSignal.reason), { once: true });

  const forwarded = new Request(c.req.raw, { signal: abort.signal });
  forwarded.headers.set(IDENTITY_EMAIL_HEADER, gateway.userEmail);
  forwarded.headers.set(IDENTITY_KEY_HEADER, gateway.keyId);

  try {
    const stub = c.env.PROXY_GATEWAY.get(c.env.PROXY_GATEWAY.idFromName(`key:${gateway.keyId}`));
    const response = await stub.fetch(forwarded);
    // The DO may answer without consuming a body it rejected (workerd reads
    // the stream after the response otherwise) — cancelling keeps that read
    // from surfacing as an unhandled rejection.
    void forwarded.body?.cancel().catch(() => undefined);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch {
    void forwarded.body?.cancel().catch(() => undefined);
    return Response.json(
      { error: { message: 'Proxy gateway unavailable', type: 'upstream_error' } },
      { status: 503, headers: { 'Retry-After': '5' } },
    );
  }
}

function registerProxyRoutes(app: ProxyApp): void {
  app.post('/v1/chat/completions', (c) => forwardToProxyGateway(c));
  app.post('/v1/embeddings', (c) => forwardToProxyGateway(c));
  app.post('/v1/responses', (c) => forwardToProxyGateway(c));

  app.get('/v1/models', async (c) => {
    const gateway = await MiddlewareHandlers.requireGateway(c as never);
    if (gateway instanceof Response) return gateway;
    try {
      const scope = createRequestScope(c.env);
      const providers = await scope.get(Tokens.ProviderService).listProviders(gateway.userEmail);
      const entries = providers
        .filter((p) => p.status === 'active' && p.kind !== 'COMMAND_CODE')
        .map((p) => ({ id: p.name, object: 'model', owned_by: p.kind.toLowerCase(), provider_id: p.id, kind: p.kind }));
      // Command Code models are namespaced (`provider/model`), so list the
      // upstream catalogue when a Command Code provider is configured.
      if (providers.some((p) => p.status === 'active' && p.kind === 'COMMAND_CODE')) {
        const models = await listCommandCodeModels(c.env, gateway.userEmail, null).catch(() => []);
        for (const model of models) {
          entries.push({
            id: model.id,
            object: 'model',
            owned_by: 'command_code',
            provider_id: model.providerId,
            kind: 'COMMAND_CODE',
          });
        }
      }
      return c.json({ object: 'list', data: entries });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.get('/commandcode/v1/models', async (c) => {
    const gateway = await MiddlewareHandlers.requireGateway(c as never);
    if (gateway instanceof Response) return gateway;
    const explicitId = c.req.header('x-provider-id')?.trim() || null;
    try {
      const models = await listCommandCodeModels(c.env, gateway.userEmail, explicitId);
      return c.json({ object: 'list', data: models });
    } catch (error) {
      return errorResponse(error);
    }
  });

  app.post('/anthropic/v1/messages', (c) => forwardToProxyGateway(c));

  app.post('/gemini/v1beta/models/:action', (c) => forwardToProxyGateway(c));
}

export { forwardToProxyGateway, registerProxyRoutes };
