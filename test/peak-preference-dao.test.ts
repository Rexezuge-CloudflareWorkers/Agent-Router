import { describe, expect, it } from 'vitest';
import { UserPeakPreferenceDAO } from '@agent-router/backend-data/dao';
import { createFakeD1 } from './helpers/fakeD1';

describe('UserPeakPreferenceDAO', () => {
  it('reads a preference scoped case-insensitively by email', async () => {
    const { database, statements } = createFakeD1(() => ({ user_email: 'u@x.y', mode: 'reject', fallback_model: null, updated_at: 1 }));
    const dao = new UserPeakPreferenceDAO(database);
    const row = await dao.getByEmail('U@X.Y');
    expect(row?.mode).toBe('reject');
    expect(statements[0].query).toContain('lower(user_email) = lower(?)');
    expect(statements[0].bindings).toEqual(['U@X.Y']);
  });

  it('returns null when no preference exists', async () => {
    const { database } = createFakeD1(() => null);
    const dao = new UserPeakPreferenceDAO(database);
    expect(await dao.getByEmail('u@x.y')).toBeNull();
  });

  it('upserts with an ON CONFLICT clause and binds in order', async () => {
    const { database, statements } = createFakeD1();
    const dao = new UserPeakPreferenceDAO(database);
    await dao.upsert('u@x.y', 'fallback', 'moonshotai/Kimi-K2.5', 1234);
    const [statement] = statements;
    expect(statement.query).toContain('INSERT INTO user_peak_preferences');
    expect(statement.query).toContain('ON CONFLICT(user_email) DO UPDATE');
    expect(statement.bindings).toEqual(['u@x.y', 'fallback', 'moonshotai/Kimi-K2.5', 1234]);
  });
});
