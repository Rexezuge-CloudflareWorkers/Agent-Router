import { describe, expect, it } from 'vitest';
import { GatewayKeyPeakPreferenceDAO } from '@agent-router/backend-data/dao';
import type { GatewayKeyDAO, GatewayKeyPeakPreferenceDAO as PeakDao } from '@agent-router/backend-data/dao';
import { GatewayKeyService } from '@agent-router/backend-services/gateway';
import type { GatewayKeyPeakPreferenceRow } from '@agent-router/backend-data/dao';
import { createFakeD1 } from './helpers/fakeD1';

type Sink = { keyId?: string; mode?: string; fallback?: string | null };

function preferenceDAO(row: GatewayKeyPeakPreferenceRow | null, sink?: Sink): () => Promise<PeakDao> {
  return async () =>
    ({
      getByKeyId: async () => row,
      upsert: async (keyId: string, mode: string, fallbackModel: string | null) => {
        if (sink) Object.assign(sink, { keyId, mode, fallback: fallbackModel });
      },
    }) as unknown as PeakDao;
}

function gatewayKeyDAO(owned = true): () => Promise<GatewayKeyDAO> {
  return async () =>
    ({
      getByIdAndUser: async () => (owned ? { keyId: 'gw-1', userEmail: 'u@x.y' } : null),
    }) as unknown as GatewayKeyDAO;
}

function serviceWith(row: GatewayKeyPeakPreferenceRow | null, sink?: Sink, owned = true): GatewayKeyService {
  return new GatewayKeyService({ DB: {} as never }, { peakPreferenceDAO: preferenceDAO(row, sink), gatewayKeyDAO: gatewayKeyDAO(owned) });
}

describe('GatewayKeyPeakPreferenceDAO', () => {
  it('reads a preference by key id', async () => {
    const { database, statements } = createFakeD1(() => ({
      key_id: 'gw-1',
      mode: 'reject',
      fallback_model: null,
      updated_at: 1,
    }));
    const row = await new GatewayKeyPeakPreferenceDAO(database).getByKeyId('gw-1');
    expect(row?.mode).toBe('reject');
    expect(statements[0].query).toContain('WHERE key_id = ?');
    expect(statements[0].bindings).toEqual(['gw-1']);
  });

  it('returns null when no preference exists', async () => {
    const { database } = createFakeD1(() => null);
    expect(await new GatewayKeyPeakPreferenceDAO(database).getByKeyId('gw-1')).toBeNull();
  });

  it('upserts with an ON CONFLICT clause and binds in order', async () => {
    const { database, statements } = createFakeD1();
    await new GatewayKeyPeakPreferenceDAO(database).upsert('gw-1', 'fallback', 'moonshotai/Kimi-K2.5', 1234);
    const [statement] = statements;
    expect(statement.query).toContain('INSERT INTO gateway_key_peak_preferences');
    expect(statement.query).toContain('ON CONFLICT(key_id) DO UPDATE');
    expect(statement.bindings).toEqual(['gw-1', 'fallback', 'moonshotai/Kimi-K2.5', 1234]);
  });
});

describe('GatewayKeyService peak preference', () => {
  it('defaults to continue when no row exists', async () => {
    expect(await serviceWith(null).getPeakPreference('gw-1')).toEqual({ mode: 'continue', fallbackModel: null });
  });

  it('ignores an unknown persisted mode', async () => {
    const service = serviceWith({ key_id: 'gw-1', mode: 'bogus', fallback_model: null, updated_at: 1 });
    expect((await service.getPeakPreference('gw-1')).mode).toBe('continue');
  });

  it('returns the fallback model only in fallback mode', async () => {
    const fallback = serviceWith({
      key_id: 'gw-1',
      mode: 'fallback',
      fallback_model: 'moonshotai/Kimi-K2.5',
      updated_at: 1,
    });
    expect(await fallback.getPeakPreference('gw-1')).toEqual({ mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' });

    const reject = serviceWith({ key_id: 'gw-1', mode: 'reject', fallback_model: 'stale', updated_at: 1 });
    expect(await reject.getPeakPreference('gw-1')).toEqual({ mode: 'reject', fallbackModel: null });
  });

  it('rejects an invalid mode', async () => {
    await expect(serviceWith(null).updatePeakPreference('gw-1', 'u@x.y', { mode: 'nope' })).rejects.toThrow(/mode must be one of/);
  });

  it('requires a fallback model when mode is fallback', async () => {
    await expect(
      serviceWith(null).updatePeakPreference('gw-1', 'u@x.y', { mode: 'fallback', fallbackModel: ' '.repeat(3) }),
    ).rejects.toThrow(/fallbackModel is required/);
  });

  it('clears the fallback model for continue and reject', async () => {
    const sink: Sink = {};
    const saved = await serviceWith(null, sink).updatePeakPreference('gw-1', 'u@x.y', {
      mode: 'reject',
      fallbackModel: 'ignored',
    });
    expect(saved).toEqual({ mode: 'reject', fallbackModel: null });
    expect(sink).toEqual({ keyId: 'gw-1', mode: 'reject', fallback: null });
  });

  it('trims and persists the fallback for the given key', async () => {
    const sink: Sink = {};
    const saved = await serviceWith(null, sink).updatePeakPreference('gw-1', 'U@X.Y', {
      mode: 'fallback',
      fallbackModel: '  moonshotai/Kimi-K2.5  ',
    });
    expect(saved).toEqual({ mode: 'fallback', fallbackModel: 'moonshotai/Kimi-K2.5' });
    expect(sink).toEqual({ keyId: 'gw-1', mode: 'fallback', fallback: 'moonshotai/Kimi-K2.5' });
  });

  it('refuses to read or write settings for a key the user does not own', async () => {
    const service = serviceWith(null, {}, false);
    await expect(service.getPeakStatus('gw-1', 'u@x.y')).rejects.toThrow(/Gateway key not found/);
    await expect(service.updatePeakPreference('gw-1', 'u@x.y', { mode: 'reject' })).rejects.toThrow(/Gateway key not found/);
  });

  it('reports peak status against a supplied instant', async () => {
    const service = serviceWith(null);
    const peak = await service.getPeakStatus('gw-1', 'u@x.y', new Date('2026-01-05T01:00:00Z'));
    expect(peak.isPeak).toBe(true);
    expect(peak.activeModelFamilies).toContain('deepseek');

    const offPeak = await service.getPeakStatus('gw-1', 'u@x.y', new Date('2026-01-10T02:00:00Z'));
    expect(offPeak.isPeak).toBe(false);
  });
});
