import type { Hono } from 'hono';
import { Tokens, createRequestScope } from '@agent-router/backend-services/composition';
import { badRequest, respond } from './routeSupport';
import type { WebSearchSettingsInput } from '@agent-router/backend-services/search';

type UserApp = Hono<{ Bindings: Env; Variables: { AuthenticatedUserEmailAddress: string } }>;

function registerWebSearchSettingsRoutes(app: UserApp): void {
  app.get('/user/settings/web-search', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    return respond(async () => {
      const settings = await createRequestScope(c.env).get(Tokens.WebSearchSettingsService).getSettings(email);
      return Response.json(settings);
    });
  });

  app.patch('/user/settings/web-search', async (c) => {
    const email = c.get('AuthenticatedUserEmailAddress');
    const body = (await c.req.json().catch(() => ({}))) as Partial<WebSearchSettingsInput>;
    if (!body.mode || typeof body.mode !== 'string') return badRequest('mode is required');
    if (body.selectedProviderId !== undefined && body.selectedProviderId !== null && typeof body.selectedProviderId !== 'string') {
      return badRequest('selectedProviderId must be a string');
    }
    return respond(async () => {
      const settings = await createRequestScope(c.env)
        .get(Tokens.WebSearchSettingsService)
        .saveSettings(email, { mode: body.mode as WebSearchSettingsInput['mode'], selectedProviderId: body.selectedProviderId });
      return Response.json(settings);
    });
  });
}

export { registerWebSearchSettingsRoutes };
