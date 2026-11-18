import { DurableObject } from 'cloudflare:workers';
import { errorResponse, handleAnthropicProxy, handleGeminiProxy, handleOpenAiProxy } from '@agent-router/backend-services/proxy';
import type { ProxyIdentity } from '@agent-router/backend-services/proxy';

const IDENTITY_EMAIL_HEADER = 'x-agent-router-user-email';
const IDENTITY_KEY_HEADER = 'x-agent-router-gateway-key';

/**
Executes proxy traffic on behalf of the API worker.

The worker authenticates the gateway key and forwards the untouched request;
this object owns everything CPU-heavy (body parsing, provider resolution,
upstream calls, SSE translation) so a long generation cannot exhaust the
worker's invocation budget. Instances are sharded per gateway key, which
keeps one client's long request from queueing another's and preserves the
read/modify/write ordering of that key's health counters.
*/
class ProxyGateway extends DurableObject<Env> {
  public override async fetch(request: Request): Promise<Response> {
    const identity = readIdentity(request);
    if (!identity) {
      return Response.json({ error: { message: 'Unidentified gateway', type: 'authentication_error' } }, { status: 401 });
    }

    const pathname = new URL(request.url).pathname;
    try {
      switch (pathname) {
        case '/v1/chat/completions': {
          return await handleOpenAiProxy(this.env, request, '/chat/completions', identity);
        }
        case '/v1/embeddings': {
          return await handleOpenAiProxy(this.env, request, '/embeddings', identity);
        }
        case '/v1/responses': {
          return await handleOpenAiProxy(this.env, request, '/responses', identity);
        }
        case '/anthropic/v1/messages': {
          return await handleAnthropicProxy(this.env, request, identity);
        }
        default: {
          const gemini = /^\/gemini\/v1beta\/models\/([^/]+)$/.exec(pathname);
          return gemini ? await handleGeminiProxy(this.env, request, gemini[1], identity) : new Response('Not Found', { status: 404 });
        }
      }
    } catch (error) {
      return errorResponse(error);
    }
  }
}

function readIdentity(request: Request): ProxyIdentity | null {
  const userEmail = request.headers.get(IDENTITY_EMAIL_HEADER);
  const gatewayKeyId = request.headers.get(IDENTITY_KEY_HEADER);
  return userEmail && gatewayKeyId ? { userEmail, gatewayKeyId } : null;
}

export { ProxyGateway };
