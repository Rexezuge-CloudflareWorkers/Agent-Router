import { describe, expect, it } from 'vitest';
import { WebSearchSettingsDAO } from '@agent-router/backend-data/dao';
import type { WebSearchSettingsDAO as Dao } from '@agent-router/backend-data/dao';
import { KeyCrypto } from '@agent-router/backend-services/provider';
import { WebSearchSettingsService } from '@agent-router/backend-services/search';
import { createFakeD1 } from './helpers/fakeD1';

const MASTER = 'web-search-master-key';

function service({
  row = null,
  sink = {},
}: { row?: Record<string, unknown> | null; sink?: Record<string, unknown> } = {}): WebSearchSettingsService {
  const dao = {
    getByEmail: async () => row,
    upsert: async (...args: unknown[]) => Object.assign(sink, { args }),
  } as unknown as Dao;
  return new WebSearchSettingsService(
    { DB: {} as never, WEB_SEARCH_ENCRYPTION_SECRET: { get: async () => MASTER } },
    { dao: () => Promise.resolve(dao), masterKey: async () => MASTER, now: () => 1234 },
  );
}

describe('WebSearchSettingsDAO', () => {
  it('reads settings by lowercased email', async () => {
    const { database, statements } = createFakeD1(() => ({
      user_email: 'u@x.y',
      mode: 'third_party',
      provider: 'BRAVE',
      encrypted_api_key: 'cipher',
      key_hint: 'bra…1234',
      created_at: 1,
      updated_at: 2,
    }));
    const row = await new WebSearchSettingsDAO(database).getByEmail('U@X.Y');
    expect(row?.provider).toBe('BRAVE');
    expect(statements[0].bindings).toEqual(['u@x.y']);
  });

  it('upserts with an ON CONFLICT clause', async () => {
    const { database, statements } = createFakeD1();
    await new WebSearchSettingsDAO(database).upsert('U@X.Y', 'native', null, null, null, 9);
    expect(statements[0].query).toContain('ON CONFLICT(user_email) DO UPDATE');
    expect(statements[0].bindings).toEqual(['u@x.y', 'native', null, null, null, 9, 9]);
  });
});

describe('WebSearchSettingsService', () => {
  it('defaults to none and never exposes a ciphertext', async () => {
    expect(await service().getSettings('u@x.y')).toEqual({ mode: 'none', provider: null, keyHint: null, updatedAt: null });
  });

  it('rejects invalid modes, providers and missing keys', async () => {
    await expect(service().saveSettings('u@x.y', { mode: 'bogus' as 'none' })).rejects.toThrow(/mode must be one of/);
    await expect(service().saveSettings('u@x.y', { mode: 'third_party', provider: 'GOOGLE' })).rejects.toThrow(/provider must be one of/);
    await expect(service().saveSettings('u@x.y', { mode: 'third_party', provider: 'BRAVE' })).rejects.toThrow(/apiKey is required/);
  });

  it('encrypts a credential and returns only a hint', async () => {
    const sink: Record<string, unknown> = {};
    const saved = await service({ sink }).saveSettings('U@X.Y', { mode: 'third_party', provider: 'brave', apiKey: 'brave-secret-1234' });
    expect(saved).toEqual({ mode: 'third_party', provider: 'BRAVE', keyHint: 'bra…1234', updatedAt: 1234 });
    const args = sink.args as unknown[];
    expect(args[0]).toBe('u@x.y');
    expect(args[2]).toBe('BRAVE');
    const encrypted = args[3] as string;
    expect(encrypted).not.toContain('brave-secret');
    expect(await KeyCrypto.decrypt(encrypted, MASTER, 'web-search-keys')).toBe('brave-secret-1234');
  });

  it('reuses the stored credential when no new key is supplied', async () => {
    const encrypted = await KeyCrypto.encrypt('tavily-key', MASTER, 'web-search-keys');
    const row = {
      user_email: 'u@x.y',
      mode: 'third_party',
      provider: 'TAVILY',
      encrypted_api_key: encrypted,
      key_hint: 'tav…-key',
      created_at: 1,
      updated_at: 2,
    };
    const sink: Record<string, unknown> = {};
    const saved = await service({ row, sink }).saveSettings('u@x.y', { mode: 'third_party', provider: 'TAVILY' });
    expect(saved.keyHint).toBe('tav…-key');
    expect((sink.args as unknown[])[3]).toBe(encrypted);
  });

  it('clears the provider when leaving third-party mode', async () => {
    const sink: Record<string, unknown> = {};
    const saved = await service({ sink }).saveSettings('u@x.y', { mode: 'native' });
    expect(saved).toEqual({ mode: 'native', provider: null, keyHint: null, updatedAt: 1234 });
    expect((sink.args as unknown[])[2]).toBeNull();
  });

  it('decrypts only through the proxy-only accessor', async () => {
    const encrypted = await KeyCrypto.encrypt('brave-key', MASTER, 'web-search-keys');
    const row = {
      user_email: 'u@x.y',
      mode: 'third_party',
      provider: 'BRAVE',
      encrypted_api_key: encrypted,
      key_hint: 'bra…1234',
      created_at: 1,
      updated_at: 2,
    };
    expect(await service({ row }).decryptApiKey('u@x.y')).toEqual({ provider: 'BRAVE', apiKey: 'brave-key' });
    await expect(service().decryptApiKey('u@x.y')).rejects.toThrow(/not configured/);
  });
});
