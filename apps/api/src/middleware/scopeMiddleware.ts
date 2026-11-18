import type { Context, Next } from 'hono';
import { createServiceContext, setRequestScope } from '@agent-router/backend-runtime/di';
import { createRequestScope } from '@agent-router/backend-services/composition';

type ScopeContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
Single-scope-per-request middleware (Otter composition-root pattern).
Creates one `Container` + one `ServiceContext` per request and stores them
on the Hono context. Handlers resolve via `getRequestScope(c)` instead of
calling `createRequestScope(c.env)` per handler (which minted N scopes per
request and defeated singleton memoization).
*/
async function scopeMiddleware(c: ScopeContext, next: Next): Promise<Response | void> {
  const scope = createRequestScope(c.env);
  const ctx = createServiceContext(c.env);
  setRequestScope(c as never, scope, ctx);
  await next();
}

export { scopeMiddleware };
