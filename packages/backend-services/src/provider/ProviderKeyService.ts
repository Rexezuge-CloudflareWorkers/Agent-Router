import { ProviderDAO, ProviderKeyDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError } from '@rexezuge/errors';
import type { ProviderKeyMetadata, ProviderKeyStatus } from '@agent-router/shared';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { KeyCrypto } from './KeyCrypto';

interface ProviderKeyServiceEnv {
  DB: D1Queryable;
  MAX_KEYS_PER_PROVIDER?: string;
  PROVIDER_KEYS_ENCRYPTION_SECRET?: { get(): Promise<string> };
}

interface ProviderKeyServiceDeps {
  providerDAO?: () => Promise<ProviderDAO>;
  providerKeyDAO?: () => Promise<ProviderKeyDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
}

function parseOptionalLimit(raw: unknown, field: string): number | null {
  if (raw === undefined || raw === null) return null;
  let numeric: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    if (!/^\d+$/.test(trimmed)) throw new BadRequestError(`${field} must be a positive integer`);
    numeric = Number(trimmed);
  }
  if (!Number.isSafeInteger(numeric) || (numeric as number) < 1) throw new BadRequestError(`${field} must be a positive integer`);
  return numeric as number;
}

class ProviderKeyService {
  private readonly deps: Required<ProviderKeyServiceDeps>;

  constructor(
    private readonly env: ProviderKeyServiceEnv,
    deps: ProviderKeyServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    const masterKey =
      deps.masterKey ??
      (async () => {
        if (!env.PROVIDER_KEYS_ENCRYPTION_SECRET) throw new BadRequestError('Provider key encryption is not configured');
        return env.PROVIDER_KEYS_ENCRYPTION_SECRET.get();
      });
    this.deps = {
      providerDAO: () => Promise.resolve(new ProviderDAO(env.DB)),
      providerKeyDAO: () => Promise.resolve(new ProviderKeyDAO(env.DB)),
      masterKey,
      config,
      ...deps,
    };
  }

  private async requireOwnedProvider(providerId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.providerDAO();
    const provider = await dao.getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
  }

  private async requireStaticKeyTarget(providerId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.providerDAO();
    const provider = await dao.getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    if (provider.kind === 'OPENAI_CODEX')
      throw new BadRequestError('OPENAI_CODEX providers use Codex OAuth keys; connect via the Codex authorize flow');
  }

  private async assertSecretForProvider(providerId: string, userEmail: string, secret: string): Promise<void> {
    const dao = await this.deps.providerDAO();
    const provider = await dao.getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    if (provider.kind === 'COMMAND_CODE' && !secret.startsWith('user_')) {
      throw new BadRequestError('Command Code keys must start with user_');
    }
  }

  public async addKey(
    providerId: string,
    userEmail: string,
    input: { name?: unknown; secret?: unknown; tokenLimit?: unknown; requestLimit?: unknown; resetInDays?: unknown; priority?: unknown },
  ): Promise<ProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    await this.requireStaticKeyTarget(providerId, normalized);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new BadRequestError('name is required');
    if (name.length > 80) throw new BadRequestError('name must be at most 80 characters');
    const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
    if (!secret) throw new BadRequestError('secret is required');
    if (secret.length > 4096) throw new BadRequestError('secret is too long');
    await this.assertSecretForProvider(providerId, normalized, secret);
    const tokenLimit = parseOptionalLimit(input.tokenLimit, 'tokenLimit');
    const requestLimit = parseOptionalLimit(input.requestLimit, 'requestLimit');
    const resetInDays = parseOptionalLimit(input.resetInDays, 'resetInDays');
    let priority = 0;
    if (input.priority !== undefined && input.priority !== null) {
      const n = typeof input.priority === 'string' ? Number(input.priority.trim()) : (input.priority as number);
      if (!Number.isSafeInteger(n) || n < 0 || n > 1000) throw new BadRequestError('priority must be an integer 0-1000');
      priority = n;
    }
    const dao = await this.deps.providerKeyDAO();
    const max = this.deps.config.getMaxKeysPerProvider();
    if ((await dao.countByProvider(providerId)) >= max) throw new BadRequestError(`Maximum ${max} keys per provider`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const masterKey = await this.deps.masterKey();
    const id = UUIDUtil.getRandomUUID();
    await dao.create({
      id,
      providerId,
      userEmail: normalized,
      name,
      encryptedKey: await KeyCrypto.encrypt(secret, masterKey, 'provider-keys'),
      keyHint: KeyCrypto.hintFor(secret),
      tokenLimit,
      requestLimit,
      resetAt: resetInDays ? TimestampUtil.addDays(now, resetInDays) : null,
      priority,
      now,
    });
    const created = await dao.getMetadataById(id);
    if (!created) throw new NotFoundError('Provider key not found');
    return created;
  }

  public async listKeys(providerId: string, userEmail: string): Promise<ProviderKeyMetadata[]> {
    await this.requireOwnedProvider(providerId, userEmail.toLowerCase());
    const dao = await this.deps.providerKeyDAO();
    return dao.listByProvider(providerId);
  }

  public async updateKey(
    providerId: string,
    keyId: string,
    userEmail: string,
    patch: { name?: unknown; priority?: unknown; tokenLimit?: unknown; requestLimit?: unknown; status?: unknown },
  ): Promise<ProviderKeyMetadata> {
    await this.requireOwnedProvider(providerId, userEmail.toLowerCase());
    const dao = await this.deps.providerKeyDAO();
    const current = await dao.getById(keyId);
    if (!current || current.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    let status = current.status as ProviderKeyStatus;
    if (patch.status !== undefined) {
      const allowed: readonly string[] = ['active', 'disabled'];
      if (typeof patch.status !== 'string' || !allowed.includes(patch.status))
        throw new BadRequestError('status must be active or disabled');
      status = patch.status as ProviderKeyStatus;
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.updateMeta(keyId, {
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : undefined,
      priority:
        patch.priority === undefined || patch.priority === null
          ? undefined
          : (() => {
              const rawPriority: unknown = patch.priority;
              const n = typeof rawPriority === 'string' ? Number(rawPriority.trim()) : (rawPriority as number);
              if (!Number.isSafeInteger(n) || n < 0 || n > 1000) throw new BadRequestError('priority must be an integer 0-1000');
              return n;
            })(),
      tokenLimit: patch.tokenLimit === undefined ? undefined : parseOptionalLimit(patch.tokenLimit, 'tokenLimit'),
      requestLimit: patch.requestLimit === undefined ? undefined : parseOptionalLimit(patch.requestLimit, 'requestLimit'),
      status,
      now,
    });
    const updated = await dao.getMetadataById(keyId);
    if (!updated) throw new NotFoundError('Provider key not found');
    return updated;
  }

  public async rotateSecret(providerId: string, keyId: string, userEmail: string, secret: unknown): Promise<ProviderKeyMetadata> {
    await this.requireOwnedProvider(providerId, userEmail.toLowerCase());
    const raw = typeof secret === 'string' ? secret.trim() : '';
    if (!raw) throw new BadRequestError('secret is required');
    if (raw.length > 4096) throw new BadRequestError('secret is too long');
    await this.assertSecretForProvider(providerId, userEmail.toLowerCase(), raw);
    const dao = await this.deps.providerKeyDAO();
    const current = await dao.getById(keyId);
    if (!current || current.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    if ((current.auth_type ?? 'static') !== 'static')
      throw new BadRequestError('OAuth keys cannot rotate static secrets; reconnect via OAuth');
    const masterKey = await this.deps.masterKey();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    // Direct SQL via updateMeta path is insufficient for the secret; update encrypted_key + hint + clear failures.
    const db = (dao as unknown as { database: { prepare(q: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } } }).database;
    await db
      .prepare(
        'UPDATE provider_keys SET encrypted_key = ?, key_hint = ?, consecutive_failures = 0, cooldown_until = NULL, status = ?, last_error = NULL, updated_at = ? WHERE id = ?',
      )
      .bind(
        await KeyCrypto.encrypt(raw, masterKey, 'provider-keys'),
        KeyCrypto.hintFor(raw),
        current.status === 'disabled' ? 'disabled' : 'active',
        now,
        keyId,
      )
      .run();
    return (await dao.getMetadataById(keyId)) as ProviderKeyMetadata;
  }

  public async resetUsage(providerId: string, keyId: string, userEmail: string, resetInDays?: unknown): Promise<ProviderKeyMetadata> {
    await this.requireOwnedProvider(providerId, userEmail.toLowerCase());
    const dao = await this.deps.providerKeyDAO();
    const current = await dao.getById(keyId);
    if (!current || current.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const days = resetInDays === undefined || resetInDays === null ? null : parseOptionalLimit(resetInDays, 'resetInDays');
    await dao.resetUsage(keyId, days ? TimestampUtil.addDays(now, days) : current.reset_at, now);
    return (await dao.getMetadataById(keyId)) as ProviderKeyMetadata;
  }

  public async deleteKey(providerId: string, keyId: string, userEmail: string): Promise<void> {
    await this.requireOwnedProvider(providerId, userEmail.toLowerCase());
    const dao = await this.deps.providerKeyDAO();
    const current = await dao.getById(keyId);
    if (!current || current.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    await dao.delete(keyId);
  }

  public async decryptSecret(providerId: string, keyId: string, userEmail: string): Promise<string> {
    await this.requireOwnedProvider(providerId, userEmail.toLowerCase());
    const dao = await this.deps.providerKeyDAO();
    const current = await dao.getById(keyId);
    if (!current || current.provider_id !== providerId) throw new NotFoundError('Provider key not found');
    return KeyCrypto.decrypt(current.encrypted_key, await this.deps.masterKey(), 'provider-keys');
  }
}

export { ProviderKeyService };
export type { ProviderKeyServiceDeps, ProviderKeyServiceEnv };
