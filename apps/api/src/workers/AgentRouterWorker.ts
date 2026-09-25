import { AbstractEntrypointWorker } from '@agent-router/backend-runtime/base';
import { fromHono } from 'chanfana';
import type { HonoOpenAPIRouterType } from 'chanfana';
import { Hono } from 'hono';
import { MiddlewareHandlers, rateLimit, securityHeaders } from '@/middleware';
import { scopeMiddleware } from '@/middleware/scopeMiddleware';
import { SPA_HTML } from '@/generated/spa-shell';
import { registerGatewayKeyRoutes } from './routes/GatewayKeyRoutes';
import { registerProviderRoutes } from './routes/ProviderRoutes';
import { registerProxyRoutes } from './routes/ProxyRoutes';
import { registerUsageRoutes } from './routes/UsageRoutes';
import { registerUserRoutes } from './routes/UserRoutes';

type AppRouter = HonoOpenAPIRouterType<{
  Bindings: Env;
  Variables: { AuthenticatedUserEmailAddress: string };
}>;

class AgentRouterWorker extends AbstractEntrypointWorker {
  protected readonly app: AppRouter;

  constructor() {
    super();

    const app = new Hono<{
      Bindings: Env;
      Variables: { AuthenticatedUserEmailAddress: string };
    }>();

    app.use('*', securityHeaders());

    app.get('/', (c) => {
      return c.html(SPA_HTML);
    });
    app.get('/user', (c) => c.redirect('/user/' + new URL(c.req.url).search));
    app.get('/health', (c) => c.json({ ok: true, service: 'agent-router' }));

    app.use('*', scopeMiddleware);

    // Proxy abuse guard: per-isolate bucket keyed on gateway identity/IP.
    // Upstream 429s drive per-key cooldowns; this guard protects our own edge.
    app.use('/v1/*', rateLimit({ windowMs: 60_000, max: 300, keyPrefix: 'proxy' }));
    app.use('/anthropic/*', rateLimit({ windowMs: 60_000, max: 300, keyPrefix: 'proxy-anthropic' }));
    app.use('/gemini/*', rateLimit({ windowMs: 60_000, max: 300, keyPrefix: 'proxy-gemini' }));

    registerProxyRoutes(app);

    app.use('/user/*', MiddlewareHandlers.userAuthentication());
    app.use('/user/gateway-keys*', rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'gateway-keys' }));
    app.use('/user/providers*', rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'providers' }));

    registerUserRoutes(app);
    registerGatewayKeyRoutes(app);
    registerProviderRoutes(app);
    registerUsageRoutes(app);

    const openapi: AppRouter = fromHono(app, { docs_url: '/docs' });

    // SPA catch-all for the management UI.
    app.get('*', (c) => {
      const path: string = new URL(c.req.url).pathname;
      return path === '/' ||
        path === '/settings' ||
        path === '/providers' ||
        path === '/keys' ||
        path === '/usage' ||
        path.startsWith('/user/') ? c.html(SPA_HTML) : c.notFound();
    });

    this.app = openapi;
  }

  protected async onRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return this.app.fetch(request, env, ctx);
  }

  protected onScheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const id = env.CRON_TASKS.idFromName('global');
    const stub = env.CRON_TASKS.get(id);
    ctx.waitUntil(
      stub
        .fetch(
          new Request('https://do/run', {
            method: 'POST',
            body: JSON.stringify({ cron: event.cron, scheduledTime: event.scheduledTime }),
          }),
        )
        .then((res: Response) => {
          if (!res.ok && res.status !== 202) {
            console.error('CronTasksWorker error', res.status);
          }
        })
        .catch((error: unknown) => console.error('Cron invoke failed', error)),
    );
    return Promise.resolve();
  }
}

export { AgentRouterWorker };
