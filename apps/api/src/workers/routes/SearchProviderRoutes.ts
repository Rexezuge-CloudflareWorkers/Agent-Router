import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { respond } from './routeSupport';

type SearchProviderApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
CRUD for third-party search providers and their key pools. The shape
mirrors ProviderRoutes so both registries have the same management flow.
*/
function registerSearchProviderRoutes(app: SearchProviderApp): void {
  app.get('/user/search-providers', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return c.json({ searchProviders: await createRequestScope(c.env).get(Tokens.SearchProviderService).listProviders(email) });
  });

  app.post('/user/search-providers', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; name?: unknown };
    return respond(async () => {
      const created = await createRequestScope(c.env).get(Tokens.SearchProviderService).createProvider(email, body.kind, body.name);
      return Response.json(created, { status: 201 });
    });
  });

  app.get('/user/search-providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      return Response.json(await createRequestScope(c.env).get(Tokens.SearchProviderService).getProvider(c.req.param('id'), email));
    });
  });

  app.patch('/user/search-providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; status?: unknown };
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env).get(Tokens.SearchProviderService).updateProvider(c.req.param('id'), email, body),
      );
    });
  });

  app.delete('/user/search-providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      await createRequestScope(c.env).get(Tokens.SearchProviderService).deleteProvider(c.req.param('id'), email);
      return Response.json({ ok: true });
    });
  });

  app.get('/user/search-providers/:id/keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      return Response.json({
        keys: await createRequestScope(c.env).get(Tokens.SearchProviderKeyService).listKeys(c.req.param('id'), email),
      });
    });
  });

  app.post('/user/search-providers/:id/keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return respond(async () => {
      const created = await createRequestScope(c.env).get(Tokens.SearchProviderKeyService).addKey(c.req.param('id'), email, body);
      return Response.json(created, { status: 201 });
    });
  });

  app.patch('/user/search-providers/:id/keys/:keyId', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env)
          .get(Tokens.SearchProviderKeyService)
          .updateKey(c.req.param('id'), c.req.param('keyId'), email, body),
      );
    });
  });

  app.post('/user/search-providers/:id/keys/:keyId/rotate', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { secret?: unknown };
    return respond(async () => {
      const rotated = await createRequestScope(c.env)
        .get(Tokens.SearchProviderKeyService)
        .rotateSecret(c.req.param('id'), c.req.param('keyId'), email, body.secret);
      return Response.json(rotated, { status: 201 });
    });
  });

  app.post('/user/search-providers/:id/keys/:keyId/reset-usage', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { resetInDays?: unknown };
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env)
          .get(Tokens.SearchProviderKeyService)
          .resetUsage(c.req.param('id'), c.req.param('keyId'), email, body.resetInDays),
      );
    });
  });

  app.delete('/user/search-providers/:id/keys/:keyId', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      await createRequestScope(c.env).get(Tokens.SearchProviderKeyService).deleteKey(c.req.param('id'), c.req.param('keyId'), email);
      return Response.json({ ok: true });
    });
  });
}

export { registerSearchProviderRoutes };
