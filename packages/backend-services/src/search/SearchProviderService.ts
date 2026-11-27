import { SearchProviderDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError } from '@rexezuge/errors';
import { isSearchProviderKind } from '@agent-router/shared';

import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import type { SearchProviderMetadata } from '@agent-router/shared';

interface SearchProviderServiceEnv {
  DB: D1Queryable;
  MAX_PROVIDERS_PER_USER?: string;
}

interface SearchProviderServiceDeps {
  dao?: () => Promise<SearchProviderDAO>;
  config?: AppConfiguration;
}

/**
Mirrors ProviderService for the separate third-party search registry.
*/
class SearchProviderService {
  private readonly deps: Required<SearchProviderServiceDeps>;

  constructor(
    private readonly env: SearchProviderServiceEnv,
    deps: SearchProviderServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(this.env);
    this.deps = {
      dao: deps.dao ?? (() => Promise.resolve(new SearchProviderDAO(this.env.DB))),
      config,
    };
  }

  public async createProvider(userEmail: string, kind: unknown, name: unknown): Promise<SearchProviderMetadata> {
    if (!isSearchProviderKind(kind)) throw new BadRequestError('kind must be one of BRAVE or TAVILY');
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) throw new BadRequestError('name is required');
    if (trimmed.length > 80) throw new BadRequestError('name must be at most 80 characters');
    const normalized = userEmail.toLowerCase();
    const dao = await this.deps.dao();
    const max = this.deps.config.getMaxProvidersPerUser();
    if ((await dao.countByUser(normalized)) >= max) throw new BadRequestError(`Maximum ${max} search providers allowed`);
    const existing = await dao.listByUser(normalized);
    if (existing.some((provider) => provider.name.toLowerCase() === trimmed.toLowerCase())) {
      throw new BadRequestError('Search provider name is already taken');
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const id = UUIDUtil.getRandomUUID();
    await dao.create({ id, userEmail: normalized, kind: kind, name: trimmed, now });
    const created = await dao.getById(id);
    if (!created) throw new NotFoundError('Search provider not found');
    return created;
  }

  public async listProviders(userEmail: string): Promise<SearchProviderMetadata[]> {
    return (await this.deps.dao()).listByUser(userEmail.toLowerCase());
  }

  public async getProvider(id: string, userEmail: string): Promise<SearchProviderMetadata> {
    const provider = await (await this.deps.dao()).getById(id);
    if (!provider || provider.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Search provider not found');
    return provider;
  }

  public async updateProvider(id: string, userEmail: string, patch: { name?: unknown; status?: unknown }): Promise<SearchProviderMetadata> {
    const current = await this.getProvider(id, userEmail);
    const dao = await this.deps.dao();
    let name = current.name;
    if (patch.name !== undefined) {
      const trimmed = typeof patch.name === 'string' ? patch.name.trim() : '';
      if (!trimmed) throw new BadRequestError('name is required');
      if (trimmed.length > 80) throw new BadRequestError('name must be at most 80 characters');
      const siblings = await dao.listByUser(userEmail.toLowerCase());
      if (siblings.some((provider) => provider.id !== id && provider.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new BadRequestError('Search provider name is already taken');
      }
      name = trimmed;
    }
    let status = current.status;
    if (patch.status !== undefined) {
      if (patch.status !== 'active' && patch.status !== 'disabled') throw new BadRequestError('status must be active or disabled');
      status = patch.status;
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.update(id, userEmail.toLowerCase(), { name, status, now });
    const updated = await dao.getById(id);
    if (!updated) throw new NotFoundError('Search provider not found');
    return updated;
  }

  public async deleteProvider(id: string, userEmail: string): Promise<void> {
    await this.getProvider(id, userEmail);
    await (await this.deps.dao()).delete(id, userEmail.toLowerCase());
  }
}

export { SearchProviderService };
export type { SearchProviderServiceDeps, SearchProviderServiceEnv };
