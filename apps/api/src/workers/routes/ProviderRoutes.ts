import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { respond } from './routeSupport';

type ProviderApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

/**
Provider and provider-key routes.

Handlers are one-liners over `respond(...)`: the scope is created per request,
the authenticated email comes from the middleware, and `respond` maps any
`ServiceError` to the right status. The Codex OAuth endpoints live here too
because they operate on nested provider keys.
*/
function registerProviderRoutes(app: ProviderApp): void {
  app.get('/user/providers', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return c.json({ providers: await createRequestScope(c.env).get(Tokens.ProviderService).listProviders(email) });
  });

  app.post('/user/providers', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; name?: unknown; baseUrl?: unknown };
    return respond(async () => {
      const created = await createRequestScope(c.env).get(Tokens.ProviderService).createProvider(email, body.kind, body.name, body.baseUrl);
      return Response.json(created, { status: 201 });
    });
  });

  app.get('/user/providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      return Response.json(await createRequestScope(c.env).get(Tokens.ProviderService).getProvider(c.req.param('id'), email));
    });
  });

  app.patch('/user/providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; baseUrl?: unknown; status?: unknown };
    return respond(async () => {
      return Response.json(await createRequestScope(c.env).get(Tokens.ProviderService).updateProvider(c.req.param('id'), email, body));
    });
  });

  app.delete('/user/providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      await createRequestScope(c.env).get(Tokens.ProviderService).deleteProvider(c.req.param('id'), email);
      return Response.json({ ok: true });
    });
  });

  // Nested provider keys (secrets never returned; list shows hints + usage).
  app.get('/user/providers/:id/keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      return Response.json({ keys: await createRequestScope(c.env).get(Tokens.ProviderKeyService).listKeys(c.req.param('id'), email) });
    });
  });

  app.post('/user/providers/:id/keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return respond(async () => {
      const created = await createRequestScope(c.env).get(Tokens.ProviderKeyService).addKey(c.req.param('id'), email, body);
      return Response.json(created, { status: 201 });
    });
  });

  app.patch('/user/providers/:id/keys/:keyId', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env).get(Tokens.ProviderKeyService).updateKey(c.req.param('id'), c.req.param('keyId'), email, body),
      );
    });
  });

  app.post('/user/providers/:id/keys/:keyId/rotate', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { secret?: unknown };
    return respond(async () => {
      const rotated = await createRequestScope(c.env)
        .get(Tokens.ProviderKeyService)
        .rotateSecret(c.req.param('id'), c.req.param('keyId'), email, body.secret);
      return Response.json(rotated, { status: 201 });
    });
  });

  app.post('/user/providers/:id/keys/:keyId/reset-usage', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { resetInDays?: unknown };
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env)
          .get(Tokens.ProviderKeyService)
          .resetUsage(c.req.param('id'), c.req.param('keyId'), email, body.resetInDays),
      );
    });
  });

  app.delete('/user/providers/:id/keys/:keyId', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      await createRequestScope(c.env).get(Tokens.ProviderKeyService).deleteKey(c.req.param('id'), c.req.param('keyId'), email);
      return Response.json({ ok: true });
    });
  });

  // Codex OAuth keys (OPENAI_CODEX providers): create pending key, authorize via browser/device flow, disconnect.
  app.post('/user/providers/:id/keys/codex', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; priority?: unknown };
    return respond(async () => {
      const created = await createRequestScope(c.env).get(Tokens.CodexOAuthService).createAuthorizationKey(c.req.param('id'), email, body);
      return Response.json(created, { status: 201 });
    });
  });

  app.post('/user/providers/:id/keys/:keyId/codex/device/start', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      const started = await createRequestScope(c.env)
        .get(Tokens.CodexOAuthService)
        .startDeviceAuthorization(c.req.param('id'), c.req.param('keyId'), email);
      return Response.json(started, { status: 201 });
    });
  });

  app.get('/user/providers/:id/keys/:keyId/codex/device/status', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env)
          .get(Tokens.CodexOAuthService)
          .pollDeviceAuthorization(c.req.param('id'), c.req.param('keyId'), email),
      );
    });
  });

  app.post('/user/providers/:id/keys/:keyId/codex/token', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { refreshToken?: unknown; authJson?: unknown };
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env)
          .get(Tokens.CodexOAuthService)
          .importRefreshToken(c.req.param('id'), c.req.param('keyId'), email, body),
      );
    });
  });

  app.post('/user/providers/:id/keys/:keyId/codex/disconnect', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      return Response.json(
        await createRequestScope(c.env).get(Tokens.CodexOAuthService).disconnect(c.req.param('id'), c.req.param('keyId'), email),
      );
    });
  });
}

export { registerProviderRoutes };
