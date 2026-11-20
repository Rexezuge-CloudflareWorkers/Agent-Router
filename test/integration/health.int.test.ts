import { describe, expect, it, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations } from './helpers/migrations';

describe('integration smoke', () => {
  beforeAll(async () => {
    await applyMigrations(env.DB);
  });

  it('applies migrations including the codex device tables', async () => {
    // 0005 drops the superseded codex_oauth_sessions table, so it must be absent.
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'providers', 'provider_keys', 'codex_oauth_sessions', 'codex_device_sessions') ORDER BY name`,
    ).all<{ name: string }>();
    expect((result.results ?? []).map((r) => r.name)).toEqual(['codex_device_sessions', 'provider_keys', 'providers', 'users']);
  });

  it('GET /health returns ok', async () => {
    const response: Response = await SELF.fetch('http://localhost/health');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, service: 'agent-router' });
  });

  it('POST /v1/chat/completions without a gateway key returns 401', async () => {
    const response: Response = await SELF.fetch('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
    });
    expect(response.status).toBe(401);
  });
});
