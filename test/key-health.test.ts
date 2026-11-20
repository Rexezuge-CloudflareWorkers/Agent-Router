import { describe, expect, it } from 'vitest';
import { cooldownForFailures, cooldownUntilFor, isCapExceeded, isOAuthKey, isOAuthUsable } from '@agent-router/backend-services/router';
import { toUpstreamError } from '@agent-router/backend-services/router';

function keyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'k1',
    token_limit: null,
    request_limit: null,
    used_tokens: 0,
    used_requests: 0,
    auth_type: 'static',
    oauth_status: null,
    encrypted_refresh_token: null,
    ...overrides,
  } as never;
}

describe('keyHealth', () => {
  it('detects token and request cap exhaustion', () => {
    expect(isCapExceeded(keyRow())).toBe(false);
    expect(isCapExceeded(keyRow({ token_limit: 10, used_tokens: 10 }))).toBe(true);
    expect(isCapExceeded(keyRow({ request_limit: 5, used_requests: 6 }))).toBe(true);
    // Under the cap is fine.
    expect(isCapExceeded(keyRow({ token_limit: 10, used_tokens: 9 }))).toBe(false);
  });

  it('recognizes OAuth keys and their usability', () => {
    expect(isOAuthKey(keyRow())).toBe(false);
    expect(isOAuthKey(keyRow({ auth_type: 'codex_oauth' }))).toBe(true);
    expect(isOAuthUsable(keyRow({ auth_type: 'codex_oauth', oauth_status: 'connected', encrypted_refresh_token: 'x' }))).toBe(true);
    expect(isOAuthUsable(keyRow({ auth_type: 'codex_oauth', oauth_status: 'pending', encrypted_refresh_token: 'x' }))).toBe(false);
    expect(isOAuthUsable(keyRow({ auth_type: 'codex_oauth', oauth_status: 'connected' }))).toBe(false);
  });

  it('caps exponential backoff at the seventh failure', () => {
    expect(cooldownForFailures(1000, 0)).toBe(1000);
    expect(cooldownForFailures(1000, 3)).toBe(8000);
    // Beyond 6 the exponent clamps, so it never grows unbounded.
    expect(cooldownForFailures(1000, 10)).toBe(cooldownForFailures(1000, 6));
  });

  it('returns null cooldown once the disable threshold is reached', () => {
    expect(cooldownUntilFor(9, 1000, { baseMs: 60_000, disableAfter: 10 })).not.toBeNull();
    expect(cooldownUntilFor(10, 1000, { baseMs: 60_000, disableAfter: 10 })).toBeNull();
  });
});

describe('toUpstreamError', () => {
  it('turns a Codex login page into account guidance', () => {
    const error = toUpstreamError('OPENAI_CODEX', 400, '<html><body>Verify you are human</body></html>', 'fallback', false);
    expect(error.message).toMatch(/no ChatGPT account is linked/i);
    expect(error.message).toContain('Verify you are human');
  });

  it('notes an access challenge when an account is linked', () => {
    const error = toUpstreamError('OPENAI_CODEX', 403, '<html><body>Just a moment</body></html>', 'fallback', true);
    expect(error.message).toMatch(/access challenge/i);
  });

  it('passes through a non-HTML body trimmed', () => {
    const error = toUpstreamError('OPENAI', 400, 'Bad model', 'Bad model', false);
    expect(error.message).toBe('Bad model');
  });
});
