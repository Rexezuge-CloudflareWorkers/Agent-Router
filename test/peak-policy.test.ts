import { describe, expect, it } from 'vitest';
import { Tokens } from '@agent-router/backend-services/composition';
import { applyPeakPolicy } from '@agent-router/backend-services/proxy';
import type { PeakPreference } from '@agent-router/backend-services/gateway';

const PEAK_MONDAY = new Date('2026-01-05T02:00:00Z'); // Mon 10:00 CST, inside 09:00-12:00
const OFF_PEAK_MONDAY = new Date('2026-01-05T04:30:00Z'); // Mon 12:30 CST, lunch gap

function isPreference(value: PeakPreference | Record<string, PeakPreference>): value is PeakPreference {
  return 'mode' in value;
}

function scopeWith(preferences: PeakPreference | Record<string, PeakPreference>): never {
  return {
    get(token: unknown) {
      if (token === Tokens.GatewayKeyService) {
        return {
          getPeakPreference: async (keyId: string): Promise<PeakPreference> =>
            isPreference(preferences) ? preferences : (preferences[keyId] ?? { mode: 'continue', fallbackModel: null }),
        };
      }
      throw new Error('unexpected token');
    },
  } as never;
}

describe('applyPeakPolicy', () => {
  it('allows models without a peak schedule', async () => {
    const decision = await applyPeakPolicy(scopeWith({ mode: 'reject', fallbackModel: null }), 'gw-1', 'gpt-5.5', PEAK_MONDAY);
    expect(decision).toEqual({ action: 'allow' });
  });

  it('allows when off-peak regardless of preference', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'reject', fallbackModel: null }),
      'gw-1',
      'deepseek/deepseek-v4-pro',
      OFF_PEAK_MONDAY,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('allows during peak when the key chose continue', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'continue', fallbackModel: null }),
      'gw-1',
      'deepseek/deepseek-v4-pro',
      PEAK_MONDAY,
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('rewrites to the fallback model during peak', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' }),
      'gw-1',
      'deepseek/deepseek-v4-pro',
      PEAK_MONDAY,
    );
    expect(decision).toEqual({ action: 'rewrite', model: 'moonshotai/Kimi-K2.5' });
  });

  it('rejects during peak with a 429 and a Retry-After header', async () => {
    const decision = await applyPeakPolicy(
      scopeWith({ mode: 'reject', fallbackModel: null }),
      'gw-1',
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
      'gw-1',
      'deepseek/deepseek-v4-pro',
      PEAK_MONDAY,
    );
    expect(decision.action).toBe('reject');
  });

  it('uses the policy of the authenticated key, not the user', async () => {
    const preferences: Record<string, PeakPreference> = {
      'gw-1': { mode: 'reject', fallbackModel: null },
      'gw-2': { mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' },
    };
    const first = await applyPeakPolicy(scopeWith(preferences), 'gw-1', 'deepseek/deepseek-v4-pro', PEAK_MONDAY);
    const second = await applyPeakPolicy(scopeWith(preferences), 'gw-2', 'deepseek/deepseek-v4-pro', PEAK_MONDAY);
    expect(first.action).toBe('reject');
    expect(second).toEqual({ action: 'rewrite', model: 'moonshotai/Kimi-K2.5' });
  });
});
