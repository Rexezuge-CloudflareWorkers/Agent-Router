import { SearchProviderDAO, SearchProviderKeyDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError } from '@rexezuge/errors';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import type { SearchProviderKeyMetadata, SearchProviderKeyStatus, SearchProviderMetadata } from '@agent-router/shared';
import { KeyCrypto } from '../provider/KeyCrypto';

interface SearchProviderKeyServiceEnv {
  DB: D1Queryable;
  MAX_KEYS_PER_PROVIDER?: string;
  WEB_SEARCH_ENCRYPTION_SECRET?: { get(): Promise<string> };
}

interface SearchProviderKeyServiceDeps {
  providerDAO?: () => Promise<SearchProviderDAO>;
  keyDAO?: () => Promise<SearchProviderKeyDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
}

function parseOptionalLimit(raw: unknown, field: string): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let numeric: unknown = raw;
  if (typeof raw === 'string') {
    if (!/^\d+$/.test(raw.trim())) throw new BadRequestError(`${field} must be a positive integer`);
    numeric = Number(raw.trim());
  }
  if (!Number.isSafeInteger(numeric) || (numeric as number) < 1) throw new BadRequestError(`${field} must be a positive integer`);
  return numeric as number;
}

function parsePriority(raw: unknown): number {
  const numeric = typeof raw === 'string' ? Number(raw.trim()) : (raw as number);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 1000) throw new BadRequestError('priority must be an integer 0-1000');
  return numeric;
}

/**
Key-pool CRUD for search providers, mirroring ProviderKeyService.
*/
class SearchProviderKeyService {
  private readonly deps: Required<SearchProviderKeyServiceDeps>;

  constructor(
    private readonly env: SearchProviderKeyServiceEnv,
    deps: SearchProviderKeyServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(this.env);
    const masterKey =
      deps.masterKey ??
      (async () => {
        if (!this.env.WEB_SEARCH_ENCRYPTION_SECRET) throw new BadRequestError('Web search encryption is not configured');
        return this.env.WEB_SEARCH_ENCRYPTION_SECRET.get();
      });
    this.deps = {
      providerDAO: deps.providerDAO ?? (() => Promise.resolve(new SearchProviderDAO(this.env.DB))),
      keyDAO: deps.keyDAO ?? (() => Promise.resolve(new SearchProviderKeyDAO(this.env.DB))),
      masterKey,
      config,
    };
  }

  private async requireOwnedProvider(providerId: string, userEmail: string): Promise<SearchProviderMetadata> {
    const provider = await (await this.deps.providerDAO()).getById(providerId);
    if (!provider || provider.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Search provider not found');
    return provider;
  }

  private async requireOwnedKey(providerId: string, keyId: string, userEmail: string) {
    await this.requireOwnedProvider(providerId, userEmail);
    const key = await (await this.deps.keyDAO()).getById(keyId);
    if (!key || key.provider_id !== providerId) throw new NotFoundError('Search provider key not found');
    return key;
  }

  public async addKey(
    providerId: string,
    userEmail: string,
    input: { name?: unknown; secret?: unknown; requestLimit?: unknown; resetInDays?: unknown; priority?: unknown },
  ): Promise<SearchProviderKeyMetadata> {
    const normalized = userEmail.toLowerCase();
    await this.requireOwnedProvider(providerId, normalized);
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new BadRequestError('name is required');
    if (name.length > 80) throw new BadRequestError('name must be at most 80 characters');
    const secret = typeof input.secret === 'string' ? input.secret.trim() : '';
    if (!secret) throw new BadRequestError('secret is required');
    if (secret.length > 512) throw new BadRequestError('secret is too long');
    const requestLimit = parseOptionalLimit(input.requestLimit, 'requestLimit');
    const resetInDays = parseOptionalLimit(input.resetInDays, 'resetInDays');
    const priority = input.priority === undefined || input.priority === null ? 0 : parsePriority(input.priority);
    const dao = await this.deps.keyDAO();
    const max = this.deps.config.getMaxKeysPerProvider();
    if ((await dao.countByProvider(providerId)) >= max) throw new BadRequestError(`Maximum ${max} keys per search provider`);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.create({
      id,
      providerId,
      userEmail: normalized,
      name,
      encryptedKey: await KeyCrypto.encrypt(secret, await this.deps.masterKey(), 'web-search-keys'),
      keyHint: KeyCrypto.hintFor(secret),
      requestLimit,
      resetAt: resetInDays ? TimestampUtil.addDays(now, resetInDays) : null,
      priority,
      now,
    });
    const created = await dao.getMetadataById(id);
    if (!created) throw new NotFoundError('Search provider key not found');
    return created;
  }

  public async listKeys(providerId: string, userEmail: string): Promise<SearchProviderKeyMetadata[]> {
    await this.requireOwnedProvider(providerId, userEmail.toLowerCase());
    return (await this.deps.keyDAO()).listByProvider(providerId);
  }

  public async updateKey(
    providerId: string,
    keyId: string,
    userEmail: string,
    patch: { name?: unknown; priority?: unknown; requestLimit?: unknown; status?: unknown },
  ): Promise<SearchProviderKeyMetadata> {
    const current = await this.requireOwnedKey(providerId, keyId, userEmail);
    let status = current.status as SearchProviderKeyStatus;
    if (patch.status !== undefined) {
      if (patch.status !== 'active' && patch.status !== 'disabled') throw new BadRequestError('status must be active or disabled');
      status = patch.status;
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await (
      await this.deps.keyDAO()
    ).updateMeta(keyId, {
      name: typeof patch.name === 'string' && patch.name.trim() ? patch.name.trim() : undefined,
      priority: patch.priority === undefined || patch.priority === null ? undefined : parsePriority(patch.priority),
      requestLimit: patch.requestLimit === undefined ? undefined : parseOptionalLimit(patch.requestLimit, 'requestLimit'),
      status,
      now,
    });
    const updated = await (await this.deps.keyDAO()).getMetadataById(keyId);
    if (!updated) throw new NotFoundError('Search provider key not found');
    return updated;
  }

  public async rotateSecret(providerId: string, keyId: string, userEmail: string, secret: unknown): Promise<SearchProviderKeyMetadata> {
    const current = await this.requireOwnedKey(providerId, keyId, userEmail);
    const raw = typeof secret === 'string' ? secret.trim() : '';
    if (!raw) throw new BadRequestError('secret is required');
    if (raw.length > 512) throw new BadRequestError('secret is too long');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await (
      await this.deps.keyDAO()
    ).rotateSecret(keyId, {
      encryptedKey: await KeyCrypto.encrypt(raw, await this.deps.masterKey(), 'web-search-keys'),
      keyHint: KeyCrypto.hintFor(raw),
      status: current.status === 'disabled' ? 'disabled' : 'active',
      now,
    });
    return (await (await this.deps.keyDAO()).getMetadataById(keyId)) as SearchProviderKeyMetadata;
  }

  public async resetUsage(providerId: string, keyId: string, userEmail: string, resetInDays?: unknown): Promise<SearchProviderKeyMetadata> {
    const current = await this.requireOwnedKey(providerId, keyId, userEmail);
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const days = resetInDays === undefined || resetInDays === null ? null : parseOptionalLimit(resetInDays, 'resetInDays');
    await (await this.deps.keyDAO()).resetUsage(keyId, days ? TimestampUtil.addDays(now, days) : current.reset_at, now);
    return (await (await this.deps.keyDAO()).getMetadataById(keyId)) as SearchProviderKeyMetadata;
  }

  public async deleteKey(providerId: string, keyId: string, userEmail: string): Promise<void> {
    await this.requireOwnedKey(providerId, keyId, userEmail);
    await (await this.deps.keyDAO()).delete(keyId);
  }

  /**
  Proxy-only: decrypts a credential for an actual search request.
  */
  public async decryptSecret(keyId: string, userEmail: string): Promise<string> {
    const key = await (await this.deps.keyDAO()).getById(keyId);
    if (!key || key.user_email.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Search provider key not found');
    return KeyCrypto.decrypt(key.encrypted_key, await this.deps.masterKey(), 'web-search-keys');
  }
}

export { SearchProviderKeyService };
export type { SearchProviderKeyServiceDeps, SearchProviderKeyServiceEnv };
