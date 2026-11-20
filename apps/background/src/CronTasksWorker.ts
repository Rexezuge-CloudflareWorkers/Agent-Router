import { DurableObject } from 'cloudflare:workers';
import { createLogger } from '@rexezuge/runtime';
import { runScheduledTasks } from './scheduled/TaskRegistry';

const logger = createLogger('CronTasksWorker');

class CronTasksWorker extends DurableObject<Env> {
  private currentRun: Promise<void> | null = null;

  public override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/run' || request.method !== 'POST') {
      return new Response('Not Found', { status: 404 });
    }
    if (this.currentRun) {
      return new Response('Already running', { status: 202 });
    }
    const body = (await request.json().catch(() => ({}))) as { cron?: string; scheduledTime?: number };
    // Kick the sweep off and return immediately: the whole cron run can take
    // longer than a single fetch should stay open. `ctx.waitUntil` keeps the
    // isolate alive until the promise settles, and the single-flight guard
    // prevents overlapping sweeps from stacking.
    this.currentRun = runScheduledTasks(this.env, body.cron ?? '', body.scheduledTime ?? Date.now())
      .catch((error: unknown) => {
        logger.error('Cron run failed', error);
      })
      .finally(() => {
        this.currentRun = null;
      });
    this.ctx.waitUntil(this.currentRun);
    return Response.json({ ok: true });
  }
}

export { CronTasksWorker };
export type { Env };
