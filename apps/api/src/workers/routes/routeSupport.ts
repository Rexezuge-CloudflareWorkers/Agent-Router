import type { Context } from 'hono';
import { ServiceError } from '@rexezuge/errors';

/**
Shared plumbing for the `/user/*` route handlers.

Every handler was repeating `createRequestScope(c.env).get(Tokens.X)` plus a
`try/catch` mapping `ServiceError` to a status. These helpers centralise that,
so a new route is a few lines and error mapping cannot drift between files.
*/

type UserContext = Context<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
HTTP status a thrown service error should become. Unknown errors are 500.
*/
function statusOf(error: unknown): 400 | 401 | 403 | 404 | 409 | 429 | 500 {
  if (error instanceof ServiceError) {
    const code = error.status;
    if (code === 400 || code === 401 || code === 403 || code === 404 || code === 409 || code === 429) return code;
  }
  return 500;
}

/**
JSON error envelope used by the user-facing (non-proxy) routes.
*/
function errorJson(error: unknown, status = statusOf(error)): Response {
  const message = status === 500 ? 'Internal error' : error instanceof Error ? error.message : 'Failed';
  return Response.json({ error: message }, { status });
}

/** Runs a handler body and maps thrown service errors to the error envelope.
A thrown `Response` (e.g. a validation failure) is passed through untouched. */
async function respond(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Response) return error;
    return errorJson(error);
  }
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

export { badRequest, errorJson, respond, statusOf };
export type { UserContext };
