import { describe, expect, it } from 'vitest';
import { badRequest, errorJson, respond, statusOf } from '@/workers/routes/routeSupport';
import { ServiceError } from '@rexezuge/errors';

/**
Route-support helpers underpin every `/user/*` handler, so their status
mapping and error envelope are asserted directly rather than through 18
near-identical handlers.
*/

describe('routeSupport', () => {
  it('maps ServiceError statuses and defaults unknown errors to 500', () => {
    // ServiceError subclasses expose a numeric `status`.
    const bad = Object.create(ServiceError.prototype) as ServiceError & { status: number };
    bad.status = 404;
    expect(statusOf(bad)).toBe(404);
    expect(statusOf(new Error('boom'))).toBe(500);
    expect(statusOf('nope')).toBe(500);
  });

  it('renders a generic 500 message without leaking internals', async () => {
    const res = errorJson(new Error('secret internals'), 500);
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Internal error' });
  });

  it('preserves the message for a client error', async () => {
    const res = errorJson(new Error('name is required'), 400);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'name is required' });
  });

  it('respond passes a thrown Response through untouched', async () => {
    const res = await respond(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- the helper is contractually built to pass a thrown Response through
      throw Response.json({ error: 'nope' }, { status: 409 });
    });
    expect(res.status).toBe(409);
  });

  it('respond converts a thrown error to the error envelope', async () => {
    const res = await respond(async () => {
      throw new Error('kaput');
    });
    expect(res.status).toBe(500);
  });

  it('badRequest is a 400 envelope', async () => {
    const res = badRequest('missing');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'missing' });
  });
});
