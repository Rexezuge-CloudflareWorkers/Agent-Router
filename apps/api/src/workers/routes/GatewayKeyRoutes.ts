import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { tokenIdSchema } from '@agent-router/shared/validation';
import { badRequest, respond } from './routeSupport';

type GatewayApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerGatewayKeyRoutes(app: GatewayApp): void {
  app.get('/user/gateway-keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const keys = await createRequestScope(c.env).get(Tokens.GatewayKeyService).listKeys(email);
    return c.json({ keys });
  });

  app.post('/user/gateway-keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; expiresInDays?: unknown };
    if (!body.name) return badRequest('name is required');
    return respond(async () => {
      const created = await createRequestScope(c.env)
        .get(Tokens.GatewayKeyService)
        .createKey(email, body.name as string, body.expiresInDays);
      return Response.json(created, { status: 201 });
    });
  });

  app.delete('/user/gateway-keys/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    if (!tokenIdSchema.safeParse(c.req.param('id')).success) return badRequest('Invalid key id');
    return respond(async () => {
      await createRequestScope(c.env).get(Tokens.GatewayKeyService).revokeKey(c.req.param('id'), email);
      return Response.json({ ok: true });
    });
  });

  app.get('/user/gateway-keys/:id/settings/peak', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    if (!tokenIdSchema.safeParse(c.req.param('id')).success) return badRequest('Invalid key id');
    return respond(async () => {
      const status = await createRequestScope(c.env).get(Tokens.GatewayKeyService).getPeakStatus(c.req.param('id'), email);
      return Response.json(status);
    });
  });

  app.patch('/user/gateway-keys/:id/settings/peak', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    if (!tokenIdSchema.safeParse(c.req.param('id')).success) return badRequest('Invalid key id');
    const body = await c.req.json().catch(() => ({}));
    return respond(async () => {
      const updated = await createRequestScope(c.env).get(Tokens.GatewayKeyService).updatePeakPreference(c.req.param('id'), email, body);
      return Response.json(updated);
    });
  });
}

export { registerGatewayKeyRoutes };
