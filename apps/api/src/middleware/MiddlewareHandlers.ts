import { Context, Next } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import type { AccessIdentityContext } from '@agent-router/backend-services/auth';
import { getRequestScope } from '@agent-router/backend-runtime/di';
import { UnauthorizedError, ForbiddenError } from '@rexezuge/errors';

type RequestContext = Context<{
  Bindings: Env;
  Variables: { AuthenticatedUserEmailAddress: string; GatewayUserEmail?: string; GatewayKeyId?: string };
}>;

function getScope(c: RequestContext): ReturnType<typeof createRequestScope> {
  try {
    return getRequestScope(c as never);
  } catch {
    return createRequestScope(c.env);
  }
}

async function authenticateUserIdentity(c: RequestContext): Promise<string> {
  const scope = getScope(c);
  const email = await scope
    .get(Tokens.AccessAuthService)
    .getAuthenticatedUserEmail(c.req.raw, c.executionCtx as unknown as AccessIdentityContext);
  await scope.get(Tokens.UserService).upsertUser(email);
  return email;
}

async function userAuthenticationHandler(c: RequestContext, next: Next): Promise<Response | void> {
  try {
    const userEmail = await authenticateUserIdentity(c);
    c.set('AuthenticatedUserEmailAddress', userEmail);
    await next();
  } catch (error: unknown) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    const message = status === 500 ? 'Internal error' : error instanceof Error ? error.message : 'Unauthorized';
    return c.json({ error: message }, status as 401);
  }
}

function parseBearerToken(header: string): string | null {
  const trimmed = header.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1 || trimmed.slice(0, space).toLowerCase() !== 'bearer') return null;
  const token = trimmed.slice(space + 1).trim();
  return token || null;
}

class MiddlewareHandlers {
  public static userAuthentication(): (c: RequestContext, next: Next) => Promise<Response | void> {
    return userAuthenticationHandler;
  }

  public static async requireGateway(c: RequestContext): Promise<Response | { userEmail: string; keyId: string }> {
    try {
      const existing = c.get('GatewayUserEmail' as never) as string | undefined;
      const keyId = c.get('GatewayKeyId' as never) as string | undefined;
      if (existing && keyId) return { userEmail: existing, keyId };
    } catch {
      // fall through to header auth
    }
    // Anthropic clients send the key as `x-api-key`; accept it as a fallback.
    const token = parseBearerToken(c.req.header('authorization') ?? '') ?? ((c.req.header('x-api-key') ?? '').trim() || null);
    if (!token) return c.json({ error: 'Missing gateway key' }, 401);
    try {
      return await getScope(c).get(Tokens.GatewayKeyService).authenticate(token);
    } catch (error: unknown) {
      return c.json({ error: error instanceof Error ? error.message : 'Unauthorized' }, 401);
    }
  }
}

export { MiddlewareHandlers };
export type { RequestContext };
