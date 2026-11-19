import { GatewayKeyDAO, UserDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError, UnauthorizedError } from '@rexezuge/errors';
import type { GatewayKeyMetadata } from '@agent-router/shared';
import { CryptoUtil, TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

interface GatewayKeyServiceEnv {
  DB: D1Queryable;
  MAX_GATEWAY_KEYS_PER_USER?: string;
  MAX_GATEWAY_KEY_EXPIRY_DAYS?: string;
}

interface GatewayKeyServiceDeps {
  gatewayKeyDAO?: () => Promise<GatewayKeyDAO>;
  userDAO?: () => Promise<UserDAO>;
  config?: AppConfiguration;
}

interface CreatedGatewayKey {
  keyId: string;
  key: string;
  name: string;
  expiresAt: number;
  prefix: string;
}

interface AuthenticatedGatewayKey {
  userEmail: string;
  keyId: string;
}

function keyPrefixOf(key: string): string {
  return key.slice(0, 8);
}

class GatewayKeyService {
  private readonly deps: Required<GatewayKeyServiceDeps>;

  constructor(
    private readonly env: GatewayKeyServiceEnv,
    deps: GatewayKeyServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    this.deps = {
      gatewayKeyDAO: () => Promise.resolve(new GatewayKeyDAO(env.DB)),
      userDAO: () => Promise.resolve(new UserDAO(env.DB)),
      config,
      ...deps,
    };
  }

  public static async hashKey(raw: string): Promise<string> {
    return CryptoUtil.sha256Hex(`agent-router-gw:${raw}`);
  }

  public async authenticate(raw: string): Promise<AuthenticatedGatewayKey> {
    const dao = await this.deps.gatewayKeyDAO();
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const hash = await GatewayKeyService.hashKey(raw);
    const row = await dao.getByHash(hash, now);
    if (!row) throw new UnauthorizedError('Your gateway key is invalid or has expired.');
    await dao.touchLastUsed(hash, now).catch(() => {});
    return { userEmail: row.user_email.toLowerCase(), keyId: row.key_id };
  }

  public async createKey(userEmail: string, name: string, expiresInDays?: unknown): Promise<CreatedGatewayKey> {
    const normalized = userEmail.toLowerCase();
    const maxKeys = this.deps.config.getMaxGatewayKeysPerUser();
    const maxExpiry = this.deps.config.getMaxGatewayKeyExpiryDays();
    const dao = await this.deps.gatewayKeyDAO();
    const existing = await dao.listByUser(normalized);
    const active = existing.filter((k) => k.status === 'active');
    if (active.length >= maxKeys) throw new BadRequestError(`Maximum ${maxKeys} gateway keys allowed`);
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) throw new BadRequestError('name is required');
    if (trimmed.length > 100) throw new BadRequestError('name must be at most 100 characters');
    let days: number;
    if (expiresInDays === undefined || expiresInDays === null) {
      days = maxExpiry;
    } else {
      let numeric: unknown = expiresInDays;
      if (typeof expiresInDays === 'string') {
        const t = expiresInDays.trim();
        if (!/^\d+$/.test(t)) throw new BadRequestError('expiresInDays must be a positive integer');
        numeric = Number(t);
      }
      if (!Number.isSafeInteger(numeric) || (numeric as number) < 1) throw new BadRequestError('expiresInDays must be a positive integer');
      days = numeric as number;
      if (days > maxExpiry) throw new BadRequestError(`Gateway key expiry cannot exceed ${maxExpiry} days`);
    }
    // Ensure the owner exists (Access upsert normally guarantees this).
    try {
      const userDAO = await this.deps.userDAO();
      const user = await userDAO.getByEmail(normalized);
      if (!user) {
        const now0 = TimestampUtil.getCurrentUnixTimestampInSeconds();
        await userDAO.upsertUser(normalized, now0);
      }
    } catch {
      // best-effort
    }
    const keyId = UUIDUtil.getRandomUUID();
    const raw = `ar_${UUIDUtil.getRandomUUIDNoDash()}${UUIDUtil.getRandomUUIDNoDash()}`;
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const expiresAt = TimestampUtil.addDays(now, days);
    await dao.create({
      keyId,
      userEmail: normalized,
      keyHash: await GatewayKeyService.hashKey(raw),
      keyPrefix: keyPrefixOf(raw),
      name: trimmed,
      expiresAt,
      now,
    });
    return { keyId, key: raw, name: trimmed, expiresAt, prefix: keyPrefixOf(raw) };
  }

  public async listKeys(userEmail: string): Promise<GatewayKeyMetadata[]> {
    const dao = await this.deps.gatewayKeyDAO();
    return dao.listByUser(userEmail.toLowerCase());
  }

  public async revokeKey(keyId: string, userEmail: string): Promise<void> {
    const dao = await this.deps.gatewayKeyDAO();
    await dao.revoke(keyId, userEmail.toLowerCase());
    const remaining = await dao.listByUser(userEmail.toLowerCase());
    if (remaining.every((k) => k.keyId !== keyId)) throw new NotFoundError('Gateway key not found');
  }

  public async pruneExpired(now: number, limit: number): Promise<number> {
    const dao = await this.deps.gatewayKeyDAO();
    return dao.pruneExpired(now, limit);
  }
}

export { GatewayKeyService };
export type { CreatedGatewayKey, AuthenticatedGatewayKey, GatewayKeyServiceDeps, GatewayKeyServiceEnv };
