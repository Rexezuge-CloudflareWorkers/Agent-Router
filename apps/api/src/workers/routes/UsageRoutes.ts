import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { respond } from './routeSupport';

type UsageApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
Reads a positive integer query parameter, falling back when absent/invalid.
*/
function intParam(raw: string | null, fallback: number): number {
  const value = Number(raw ?? '');
  return Number.isFinite(value) ? value : fallback;
}

function registerUsageRoutes(app: UsageApp): void {
  app.get('/user/usage/summary', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const days = intParam(new URL(c.req.url).searchParams.get('days'), 30);
    return respond(async () => {
      return Response.json(await createRequestScope(c.env).get(Tokens.UsageService).getSummary(email, days));
    });
  });

  app.get('/user/usage/ledger', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const params = new URL(c.req.url).searchParams;
    const limit = intParam(params.get('limit'), 50);
    const cursor = params.get('cursor') ?? undefined;
    return respond(async () => {
      const { entries, nextCursor } = await createRequestScope(c.env).get(Tokens.UsageService).listLedger(email, limit, cursor);
      return Response.json({ entries, nextCursor });
    });
  });
}

export { registerUsageRoutes };
