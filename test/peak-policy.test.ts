import { describe, expect, it } from 'vitest';
import { Tokens } from '@agent-router/backend-services/composition';
import { applyPeakPolicy } from '@agent-router/backend-services/proxy';
import type { PeakPreference } from '@agent-router/backend-services/user';

const PEAK_MONDAY = new Date('2026-01-05T02:00:00Z'); // Mon 10:00 CST, inside 09:00-12:00
const OFF_PEAK_MONDAY = new Date('2026-01-05T04:30:00Z'); // Mon 12:30 CST, lunch gap

function scopeWith(preference: PeakPreference): never {
  return {
    get(token: unknown) {
      if (token === Tokens.UserPeakPreferenceService) return { getPreference: async () => preference };
      throw new Error('unexpected token');
    },
  } as never;
}

describe('applyPeakPolicy', () => {
  it('allows models without a peak schedule', async () => {
    const decision = await applyPeakPolicy(scopeWith({ mode: 'reject', fallbackModel: null }), 'u@x.y', 'gpt-5.5', PEAK_MONDAY);
    expect(decision).toEqual({ action: 'allow' });
  });

  it('allows when off-peak regardless of preference', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'reject', fallbackModel: null }),
      'u@x.y',
      'deepseek/deepseek-v4-pro',
      OFF_PEAK_MONDAY,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('allows during peak when the user chose continue', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'continue', fallbackModel: null }),
      'u@x.y',
      'deepseek/deepseek-v4-pro',
      PEAK_MONDAY,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('rewrites to the fallback model during peak', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' }),
      'u@x.y',
      'deepseek/deepseek-v4-pro',
      PEAK_MONDAY,
    );
    expect(decision).toEqual({ action: 'rewrite', model: 'moonshotai/Kimi-K2.5' });
  });

  it('rejects during peak with a 429 and a Retry-After header', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'reject', fallbackModel: null }),
      'u@x.y',
      'deepseek/deepseek-v4-pro',
      PEAK_MONDAY,
    );
    expect(decision.action).toBe('reject');
    if (decision.action !== 'reject') return;
    expect(decision.response.status).toBe(429);
    expect(decision.response.headers.get('Retry-After')).toBeTruthy();
    const payload = (await decision.response.json()) as { error: { type: string } };
    expect(payload.error.type).toBe('peak_hours');
  });

  it('rejects when fallback mode has no usable model', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'fallback', fallbackModel: null }),
      'u@x.y',
      'deepseek/deepseek-v4-pro',
      PEAK_MONDAY,
    );
    expect(decision.action).toBe('reject');
  });
});
