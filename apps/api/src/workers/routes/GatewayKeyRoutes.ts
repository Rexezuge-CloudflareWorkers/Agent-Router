import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { tokenIdSchema } from '@agent-router/shared/validation';
import { ServiceError } from '@rexezuge/errors';

type GatewayApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

const RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 429]);

function statusOf(error: unknown): 400 | 401 | 403 | 404 | 429 | 500 {
  if (error instanceof ServiceError) {
    const code = error.status;
    if (RETRYABLE_STATUS_CODES.has(code)) return code as 400 | 401 | 403 | 404 | 429;
  }
  return 500;
}

function registerGatewayKeyRoutes(app: GatewayApp): void {
  app.get('/user/gateway-keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const svc = createRequestScope(c.env).get(Tokens.GatewayKeyService);
    const keys = await svc.listKeys(email);
    return c.json({ keys });
  });

  app.post('/user/gateway-keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; expiresInDays?: unknown };
    if (!body.name) return c.json({ error: 'name is required' }, 400);
    try {
      const svc = createRequestScope(c.env).get(Tokens.GatewayKeyService);
      const created = await svc.createKey(email, body.name, body.expiresInDays);
      return c.json(created, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed';
      return c.json({ error: message }, statusOf(error));
    }
  });

  app.delete('/user/gateway-keys/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    if (!tokenIdSchema.safeParse(c.req.param('id')).success) return c.json({ error: 'Invalid key id' }, 400);
    try {
      const svc = createRequestScope(c.env).get(Tokens.GatewayKeyService);
      await svc.revokeKey(c.req.param('id'), email);
      return c.json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed';
      return c.json({ error: message }, statusOf(error));
    }
  });
}

export { registerGatewayKeyRoutes };
