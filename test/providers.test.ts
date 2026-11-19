import { describe, expect, it } from 'vitest';
import { ProviderService } from '@agent-router/backend-services/provider';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

function makeService(existing: Array<{ id: string; name: string }> = []) {
  const created: Array<Record<string, unknown>> = [];
  const dao = {
    countByUser: async () => existing.length + created.length,
    listByUser: async () => [
      ...existing.map((e) => ({
        ...e,
        userEmail: 'u@x.y',
        kind: 'OPENAI',
        baseUrl: null,
        status: 'active',
        createdAt: 1,
        updatedAt: null,
      })),
      ...created.map((c) => ({
        ...c,
        userEmail: 'u@x.y',
        kind: c.kind,
        baseUrl: c.baseUrl ?? null,
        status: 'active',
        createdAt: 1,
        updatedAt: null,
      })),
    ],
    create: async (row: Record<string, unknown>) => {
      created.push(row);
    },
    getById: async (id: string) => {
      const found = [...existing, ...created].find((r) => (r as { id: string }).id === id);
      if (!found) return null;
      return {
        ...(found as object),
        userEmail: 'u@x.y',
        kind: (found as { kind?: string }).kind ?? 'OPENAI',
        baseUrl: null,
        status: 'active',
        createdAt: 1,
        updatedAt: null,
      };
    },
    update: async () => true,
    delete: async () => {},
  };
  const env = { DB: {} as never };
  const svc = new ProviderService(env, { providerDAO: () => Promise.resolve(dao as never), config: AppConfiguration.fromEnv(env) });
  return { svc, created };
}

describe('ProviderService', () => {
  it('creates providers with default base urls', async () => {
    const { svc, created } = makeService();
    const result = await svc.createProvider('u@x.y', 'OPENAI', 'Primary');
    expect(result.name).toBe('Primary');
    expect(created[0].baseUrl).toBe('https://api.openai.com/v1');
  });

  it('rejects bad kind, blank name, duplicates, and private base urls', async () => {
    const { svc } = makeService([{ id: '1', name: 'Primary' }]);
    await expect(svc.createProvider('u@x.y', 'NOPE', 'x')).rejects.toThrow();
    await expect(svc.createProvider('u@x.y', 'OPENAI', '  ')).rejects.toThrow();
    await expect(svc.createProvider('u@x.y', 'OPENAI', 'primary')).rejects.toThrow();
    await expect(svc.createProvider('u@x.y', 'OPENAI_COMPAT', 'custom', 'http://127.0.0.1:8080')).rejects.toThrow();
    await expect(svc.createProvider('u@x.y', 'OPENAI', 'other', 'https://api.openai.com/evil')).rejects.toThrow();
  });

  it('accepts custom https base urls for OPENAI_COMPAT', async () => {
    const { svc } = makeService();
    const result = await svc.createProvider('u@x.y', 'OPENAI_COMPAT', 'local', 'https://models.example.com/v1');
    expect(result.name).toBe('local');
  });
});
