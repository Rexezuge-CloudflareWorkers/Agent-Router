import { describe, expect, it } from 'vitest';
import { UserPeakPreferenceService } from '@agent-router/backend-services/user';
import type { UserPeakPreferenceDAO, UserDAO } from '@agent-router/backend-data/dao';
import type { UserPeakPreferenceRow } from '@agent-router/backend-data/dao';

function preferenceDAO(
  row: UserPeakPreferenceRow | null,
  sink?: { mode?: string; fallback?: string | null },
): () => Promise<UserPeakPreferenceDAO> {
  return async () =>
    ({
      getByEmail: async () => row,
      upsert: async (_email: string, mode: string, fallbackModel: string | null) => {
        if (!sink) {
          return;
        }

        sink.mode = mode;
        sink.fallback = fallbackModel;
      },
    }) as unknown as UserPeakPreferenceDAO;
}

function userDAO(exists = true): () => Promise<UserDAO> {
  return async () => ({ getByEmail: async () => (exists ? { email: 'u@x.y' } : null) }) as unknown as UserDAO;
}

function serviceWith(row: UserPeakPreferenceRow | null, sink?: { mode?: string; fallback?: string | null }) {
  return new UserPeakPreferenceService({ DB: {} as never }, { preferenceDAO: preferenceDAO(row, sink), userDAO: userDAO() });
}

describe('UserPeakPreferenceService', () => {
  it('defaults to continue when no row exists', async () => {
    const service = serviceWith(null);
    expect(await service.getPreference('u@x.y')).toEqual({ mode: 'continue', fallbackModel: null });
  });

  it('ignores an unknown persisted mode', async () => {
    const service = serviceWith({ user_email: 'u@x.y', mode: 'bogus', fallback_model: null, updated_at: 1 });
    expect((await service.getPreference('u@x.y')).mode).toBe('continue');
  });

  it('returns the fallback model only in fallback mode', async () => {
    const fallback = serviceWith({ user_email: 'u@x.y', mode: 'fallback', fallback_model: 'moonshotai/Kimi-K2.5', updated_at: 1 });
    expect(await fallback.getPreference('u@x.y')).toEqual({ mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' });

    const reject = serviceWith({ user_email: 'u@x.y', mode: 'reject', fallback_model: 'stale', updated_at: 1 });
    expect(await reject.getPreference('u@x.y')).toEqual({ mode: 'reject', fallbackModel: null });
  });

  it('rejects an invalid mode', async () => {
    const service = serviceWith(null);
    await expect(service.updatePreference('u@x.y', { mode: 'nope' })).rejects.toThrow(/mode must be one of/);
  });

  it('requires a fallback model when mode is fallback', async () => {
    const service = serviceWith(null);
    await expect(service.updatePreference('u@x.y', { mode: 'fallback', fallbackModel: ' '.repeat(3) })).rejects.toThrow(
      /fallbackModel is required/,
    );
  });

  it('clears the fallback model for continue and reject', async () => {
    const sink: { mode?: string; fallback?: string | null } = {};
    const service = serviceWith(null, sink);
    const saved = await service.updatePreference('u@x.y', { mode: 'reject', fallbackModel: 'ignored' });
    expect(saved).toEqual({ mode: 'reject', fallbackModel: null });
    expect(sink).toEqual({ mode: 'reject', fallback: null });
  });

  it('normalizes the email and persists the fallback', async () => {
    const sink: { mode?: string; fallback?: string | null } = {};
    const service = serviceWith(null, sink);
    const saved = await service.updatePreference('U@X.Y', { mode: 'fallback', fallbackModel: '  moonshotai/Kimi-K2.5  ' });
    expect(saved).toEqual({ mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' });
    expect(sink).toEqual({ mode: 'fallback', fallback: 'moonshotai/Kimi-K2.5' });
  });

  it('reports peak status against a supplied instant', async () => {
    const service = serviceWith(null);
    const peak = await service.getStatus('u@x.y', new Date('2026-01-05T01:00:00Z'));
    expect(peak.isPeak).toBe(true);
    expect(peak.activeModelFamilies).toContain('deepseek');

    const offPeak = await service.getStatus('u@x.y', new Date('2026-01-10T02:00:00Z'));
    expect(offPeak.isPeak).toBe(false);
  });
});
