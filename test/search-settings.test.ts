import { describe, expect, it } from 'vitest';
import { WebSearchSettingsDAO } from '@agent-router/backend-data/dao';
import type { SearchProviderDAO, WebSearchSettingsDAO as Dao } from '@agent-router/backend-data/dao';
import { WebSearchSettingsService } from '@agent-router/backend-services/search';
import { createFakeD1 } from './helpers/fakeD1';

function service({
  sink = {},
  provider = { id: 'sp-brave', userEmail: 'u@x.y', kind: 'BRAVE', name: 'Brave', status: 'active', createdAt: 1, updatedAt: null },
}: {
  sink?: Record<string, unknown>;
  provider?: Record<string, unknown> | null;
} = {}): WebSearchSettingsService {
  const dao = {
    getByEmail: async () => null,
    upsert: async (...args: unknown[]) => Object.assign(sink, { args }),
  } as unknown as Dao;
  const providerDAO = { getById: async () => provider } as unknown as SearchProviderDAO;
  return new WebSearchSettingsService(
    { DB: {} as never },
    { dao: () => Promise.resolve(dao), searchProviderDAO: () => Promise.resolve(providerDAO), now: () => 1234 },
  );
}

describe('WebSearchSettingsDAO', () => {
  it('reads settings by lowercased email', async () => {
    const { database, statements } = createFakeD1(() => ({
      user_email: 'u@x.y',
      mode: 'third_party',
      selected_provider_id: 'sp-brave',
      created_at: 1,
      updated_at: 2,
    }));
    const row = await new WebSearchSettingsDAO(database).getByEmail('U@X.Y');
    expect(row?.selected_provider_id).toBe('sp-brave');
    expect(statements[0].bindings).toEqual(['u@x.y']);
  });

  it('upserts mode and selected provider with an ON CONFLICT clause', async () => {
    const { database, statements } = createFakeD1();
    await new WebSearchSettingsDAO(database).upsert('U@X.Y', 'third_party', 'sp-brave', 9);
    expect(statements[0].query).toContain('ON CONFLICT(user_email) DO UPDATE');
    expect(statements[0].bindings).toEqual(['u@x.y', 'third_party', 'sp-brave', 9, 9]);
  });
});

describe('WebSearchSettingsService', () => {
  it('defaults to none and selects all providers automatically', async () => {
    expect(await service().getSettings('u@x.y')).toEqual({ mode: 'none', selectedProviderId: null, updatedAt: null });
  });

  it('rejects invalid modes and unknown or foreign providers', async () => {
    await expect(service().saveSettings('u@x.y', { mode: 'bogus' as 'none' })).rejects.toThrow(/mode must be one of/);
    await expect(service({ provider: null }).saveSettings('u@x.y', { mode: 'third_party', selectedProviderId: 'sp-x' })).rejects.toThrow(
      /Search provider not found/,
    );
    await expect(
      service({ provider: { id: 'sp-x', userEmail: 'other@x.y', kind: 'BRAVE', status: 'active' } }).saveSettings('u@x.y', {
        mode: 'third_party',
        selectedProviderId: 'sp-x',
      }),
    ).rejects.toThrow(/Search provider not found/);
    await expect(
      service({ provider: { id: 'sp-x', userEmail: 'u@x.y', kind: 'BRAVE', status: 'disabled' } }).saveSettings('u@x.y', {
        mode: 'third_party',
        selectedProviderId: 'sp-x',
      }),
    ).rejects.toThrow(/disabled/);
  });

  it('saves the selected provider without ever handling a credential', async () => {
    const sink: Record<string, unknown> = {};
    const saved = await service({ sink }).saveSettings('U@X.Y', { mode: 'third_party', selectedProviderId: 'sp-brave' });
    expect(saved).toEqual({ mode: 'third_party', selectedProviderId: 'sp-brave', updatedAt: 1234 });
    expect((sink.args as unknown[]).slice(0, 3)).toEqual(['u@x.y', 'third_party', 'sp-brave']);
  });

  it('clears the selection when leaving third-party mode', async () => {
    const sink: Record<string, unknown> = {};
    const saved = await service({ sink }).saveSettings('u@x.y', { mode: 'native' });
    expect(saved).toEqual({ mode: 'native', selectedProviderId: null, updatedAt: 1234 });
    expect((sink.args as unknown[])[2]).toBeNull();
  });
});
