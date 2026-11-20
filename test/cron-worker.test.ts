import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
CronTasksWorker contract: reject non-POST/other paths, single-flight overlapping
runs with 202, and return `{ ok: true }` *before* the sweep finishes (the sweep
is kept alive by `ctx.waitUntil`). `runScheduledTasks` is mocked so the test
drives the worker without touching D1.
*/

const runScheduledTasks = vi.fn(async () => {});
vi.mock('@agent-router/background/scheduled/TaskRegistry', () => ({
  runScheduledTasks,
  CRON_TASK_DEFINITIONS: [],
}));

async function makeWorker() {
  const { CronTasksWorker } = await import('@agent-router/background/CronTasksWorker');
  const waited: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => waited.push(p) } as unknown as DurableObjectState;
  const env = {} as Env;
  // The mock DurableObject base ignores ctx/env; the worker only uses this.env.
  const worker = new (
    CronTasksWorker as unknown as new (
      ctx: unknown,
      env: unknown,
    ) => {
      fetch(request: Request): Promise<Response>;
    }
  )(ctx, env);
  return { worker, waited };
}

function runRequest(): Request {
  return new Request('https://do/run', { method: 'POST', body: JSON.stringify({ cron: '*/10 * * * *', scheduledTime: 1 }) });
}

describe('CronTasksWorker', () => {
  beforeEach(() => runScheduledTasks.mockClear());

  it('returns 404 for a non-/run path', async () => {
    const { worker } = await makeWorker();
    const res = await worker.fetch(new Request('https://do/other', { method: 'POST' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a GET', async () => {
    const { worker } = await makeWorker();
    const res = await worker.fetch(new Request('https://do/run'));
    expect(res.status).toBe(404);
  });

  it('returns ok immediately and defers the sweep to waitUntil', async () => {
    let release!: () => void;
    runScheduledTasks.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { worker, waited } = await makeWorker();
    const res = await worker.fetch(runRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    // The sweep has not finished yet, but was handed to waitUntil.
    expect(waited).toHaveLength(1);
    release();
    await waited[0];
  });

  it('reports 202 while a run is already in flight (single-flight)', async () => {
    let release!: () => void;
    runScheduledTasks.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { worker } = await makeWorker();
    await worker.fetch(runRequest());
    const second = await worker.fetch(runRequest());
    expect(second.status).toBe(202);
    release();
  });
});
