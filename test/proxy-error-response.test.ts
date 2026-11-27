import { describe, expect, it } from 'vitest';
import { BadGatewayError } from '@rexezuge/errors';
import { errorResponse } from '@agent-router/backend-services/proxy';
import { UpstreamIdleError } from '@agent-router/backend-services/router';

/**
Proxy error envelope: exposed 5xx service errors keep their message.
*/
describe('errorResponse', () => {
  it('exposes an upstream idle 504 with its message', async () => {
    const response = errorResponse(new UpstreamIdleError('Command Code idle timeout'));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: { message: 'Command Code idle timeout', type: 'upstream_error' } });
  });

  it('hides an unexposed gateway error', async () => {
    const response = errorResponse(new BadGatewayError('internal detail'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { message: 'Internal error', type: 'internal_error' } });
  });
});
