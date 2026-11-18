import { adminSecretsStore } from 'cloudflare:test';
import type { SecretsStoreSecret } from 'cloudflare:workers';
import { applyMigrations } from './migrations';

/**
 * Shared setup for integration tests (real D1 via `SELF.fetch`).
 */

const VALID_BASE64_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

type TestEnv = Record<string, unknown> & { DB: D1Database };

async function ensureSecret(env: TestEnv, binding: string, value: string = VALID_BASE64_KEY): Promise<void> {
  const secret = env[binding] as SecretsStoreSecret | undefined;
  if (secret) {
    await adminSecretsStore(secret).create(value);
  }
}

export async function ensureAesSecret(env: TestEnv): Promise<void> {
  await ensureSecret(env, 'PROVIDER_KEYS_ENCRYPTION_SECRET');
  await ensureSecret(env, 'CODEX_OAUTH_ENCRYPTION_SECRET');
  await ensureSecret(env, 'COMMAND_CODE_FINGERPRINT_SALT');
}

export async function ensureUser(db: D1Database, email: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`INSERT OR IGNORE INTO users (email, created_at, updated_at) VALUES (?, ?, ?)`)
    .bind(email, now, now)
    .run();
}

export async function setupIntegrationTest(env: TestEnv, userEmail?: string): Promise<void> {
  await applyMigrations(env.DB);
  await ensureAesSecret(env);
  if (userEmail) {
    await ensureUser(env.DB, userEmail);
  }
}

export { VALID_BASE64_KEY };
