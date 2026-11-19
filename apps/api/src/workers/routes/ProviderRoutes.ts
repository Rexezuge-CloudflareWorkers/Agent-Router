import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { ServiceError } from '@rexezuge/errors';

type ProviderApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function statusOf(error: unknown): 400 | 404 | 500 {
  if (error instanceof ServiceError) {
    const code = error.status;
    if (code === 400 || code === 404) return code;
  }
  return 500;
}

function registerProviderRoutes(app: ProviderApp): void {
  app.get('/user/providers', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const svc = createRequestScope(c.env).get(Tokens.ProviderService);
    return c.json({ providers: await svc.listProviders(email) });
  });

  app.post('/user/providers', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { kind?: unknown; name?: unknown; baseUrl?: unknown };
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderService);
      const created = await svc.createProvider(email, body.kind, body.name, body.baseUrl);
      return c.json(created, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.get('/user/providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderService);
      return c.json(await svc.getProvider(c.req.param('id'), email));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.patch('/user/providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; baseUrl?: unknown; status?: unknown };
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderService);
      return c.json(await svc.updateProvider(c.req.param('id'), email, body));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.delete('/user/providers/:id', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderService);
      await svc.deleteProvider(c.req.param('id'), email);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  // Nested provider keys (secrets never returned; list shows hints + usage).
  app.get('/user/providers/:id/keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderKeyService);
      return c.json({ keys: await svc.listKeys(c.req.param('id'), email) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.post('/user/providers/:id/keys', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      secret?: unknown;
      tokenLimit?: unknown;
      requestLimit?: unknown;
      resetInDays?: unknown;
      priority?: unknown;
    };
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderKeyService);
      const created = await svc.addKey(c.req.param('id'), email, body);
      return c.json(created, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.patch('/user/providers/:id/keys/:keyId', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      priority?: unknown;
      tokenLimit?: unknown;
      requestLimit?: unknown;
      status?: unknown;
    };
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderKeyService);
      return c.json(await svc.updateKey(c.req.param('id'), c.req.param('keyId'), email, body));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.post('/user/providers/:id/keys/:keyId/rotate', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { secret?: unknown };
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderKeyService);
      return c.json(await svc.rotateSecret(c.req.param('id'), c.req.param('keyId'), email, body.secret), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.post('/user/providers/:id/keys/:keyId/reset-usage', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { resetInDays?: unknown };
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderKeyService);
      return c.json(await svc.resetUsage(c.req.param('id'), c.req.param('keyId'), email, body.resetInDays));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.delete('/user/providers/:id/keys/:keyId', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    try {
      const svc = createRequestScope(c.env).get(Tokens.ProviderKeyService);
      await svc.deleteKey(c.req.param('id'), c.req.param('keyId'), email);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  // Codex OAuth keys (OPENAI_CODEX providers): create pending key, authorize via browser PKCE, disconnect.
  app.post('/user/providers/:id/keys/codex', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { name?: unknown; priority?: unknown };
    try {
      const svc = createRequestScope(c.env).get(Tokens.CodexOAuthService);
      const created = await svc.createAuthorizationKey(c.req.param('id'), email, body);
      return c.json(created, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  // Codex device-code flow (OPENAI_CODEX providers): start a device
  // authorization, poll its status, or import a pasted refresh token.
  app.post('/user/providers/:id/keys/:keyId/codex/device/start', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    try {
      const svc = createRequestScope(c.env).get(Tokens.CodexOAuthService);
      return c.json(await svc.startDeviceAuthorization(c.req.param('id'), c.req.param('keyId'), email), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.get('/user/providers/:id/keys/:keyId/codex/device/status', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    try {
      const svc = createRequestScope(c.env).get(Tokens.CodexOAuthService);
      return c.json(await svc.pollDeviceAuthorization(c.req.param('id'), c.req.param('keyId'), email));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.post('/user/providers/:id/keys/:keyId/codex/token', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { refreshToken?: unknown; authJson?: unknown };
    try {
      const svc = createRequestScope(c.env).get(Tokens.CodexOAuthService);
      return c.json(await svc.importRefreshToken(c.req.param('id'), c.req.param('keyId'), email, body));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });

  app.post('/user/providers/:id/keys/:keyId/codex/disconnect', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    try {
      const svc = createRequestScope(c.env).get(Tokens.CodexOAuthService);
      return c.json(await svc.disconnect(c.req.param('id'), c.req.param('keyId'), email));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed' }, statusOf(error));
    }
  });
}

export { registerProviderRoutes };
