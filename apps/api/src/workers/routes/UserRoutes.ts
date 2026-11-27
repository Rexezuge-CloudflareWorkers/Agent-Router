import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';

type UserApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerUserRoutes(app: UserApp): void {
  app.get('/user/me', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const profile = await createRequestScope(c.env).get(Tokens.UserService).getProfileByEmail(email);
    return c.json(profile);
  });

  app.patch('/user/me/username', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as { username?: string };
    if (!body.username || typeof body.username !== 'string') return c.json({ error: 'username is required' }, 400);
    try {
      const renamed = await createRequestScope(c.env).get(Tokens.UserService).renameUsername(email, body.username);
      return c.json(renamed);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : 'Failed to rename' }, 400);
    }
  });
}

export { registerUserRoutes };
