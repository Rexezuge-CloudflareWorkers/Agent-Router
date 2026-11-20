import type { Container } from '@rexezuge/runtime';
import type { ServiceContext } from './ServiceContext';
import type { ServiceEnv } from '../config/ServiceEnv';

/**
Memoized async factory helper for the composition root.
Replaces hand-rolled `let pending; return () => (pending ??= fn())`
closures scattered across `requestScope.ts`.
*/
function memoizeAsync<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= fn());
}

/**
Single-scope-per-request helper (Otter pattern).
Middleware creates one `Container` + one `ServiceContext` per request and
stores them on the Hono context; handlers resolve via `getScope(c)` instead
of calling `createRequestScope(c.env)` per handler (which minted N scopes
per request and broke singleton memoization).
*/
interface ScopedContext {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  readonly env: ServiceEnv;
}

const SCOPE_KEY = '__agentRouterScope';
const SERVICE_CONTEXT_KEY = '__agentRouterServiceContext';

function setRequestScope(c: ScopedContext, scope: Container, ctx: ServiceContext): void {
  c.set(SCOPE_KEY, scope);
  c.set(SERVICE_CONTEXT_KEY, ctx);
}

function getRequestScope(c: ScopedContext): Container {
  const scope = c.get(SCOPE_KEY) as Container | undefined;
  if (!scope) throw new Error('Request scope is not set. Register scopeMiddleware before routes.');
  return scope;
}

export { memoizeAsync, setRequestScope, getRequestScope, SCOPE_KEY, SERVICE_CONTEXT_KEY };
export type { ScopedContext };
