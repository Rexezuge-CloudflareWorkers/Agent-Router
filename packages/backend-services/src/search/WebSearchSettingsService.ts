import { SearchProviderDAO, WebSearchSettingsDAO } from '@agent-router/backend-data/dao';
import { BadRequestError } from '@rexezuge/errors';
import { TimestampUtil } from '@rexezuge/shared';
import { isSearchProviderKind } from '@agent-router/shared';
import type { WebSearchSettings, WebSearchSettingsDeps, WebSearchSettingsEnv, WebSearchSettingsInput } from './types';
import { isWebSearchMode } from './types';

/**
Owns the per-user web search routing mode and the selected search provider.
Credentials no longer live here: they belong to the search provider's key
pool, managed through the same CRUD surface as model provider keys.
*/
class WebSearchSettingsService {
  private readonly deps: Required<WebSearchSettingsDeps>;
  /**
  One service instance lives for one request; cache its settings reads.
  */
  private readonly cache = new Map<string, Promise<WebSearchSettings>>();

  constructor(
    private readonly env: WebSearchSettingsEnv,
    deps: WebSearchSettingsDeps = {},
  ) {
    this.deps = {
      dao: deps.dao ?? (() => Promise.resolve(new WebSearchSettingsDAO(this.env.DB))),
      searchProviderDAO: deps.searchProviderDAO ?? (() => Promise.resolve(new SearchProviderDAO(this.env.DB))),
      now: deps.now ?? (() => TimestampUtil.getCurrentUnixTimestampInSeconds()),
    };
  }

  public async getSettings(userEmail: string): Promise<WebSearchSettings> {
    const key = userEmail.toLowerCase();
    let cached = this.cache.get(key);
    if (!cached) {
      cached = this.loadSettings(key);
      this.cache.set(key, cached);
    }
    return cached;
  }

  private async loadSettings(userEmail: string): Promise<WebSearchSettings> {
    const row = await (await this.deps.dao()).getByEmail(userEmail);
    if (!row) return { mode: 'none', selectedProviderId: null, updatedAt: null };
    return {
      mode: isWebSearchMode(row.mode) ? row.mode : 'none',
      selectedProviderId: row.selected_provider_id,
      updatedAt: row.updated_at,
    };
  }

  public async saveSettings(userEmail: string, input: WebSearchSettingsInput): Promise<WebSearchSettings> {
    if (!isWebSearchMode(input.mode)) throw new BadRequestError('mode must be one of none, native or third_party');
    const normalized = userEmail.toLowerCase();
    const selectedProviderId = input.selectedProviderId ?? null;
    if (selectedProviderId) {
      const provider = await (await this.deps.searchProviderDAO()).getById(selectedProviderId);
      if (!provider || provider.userEmail.toLowerCase() !== normalized || !isSearchProviderKind(provider.kind)) {
        throw new BadRequestError('Search provider not found');
      }
      if (provider.status !== 'active') throw new BadRequestError('Search provider is disabled');
    }
    const now = this.deps.now();
    await (await this.deps.dao()).upsert(normalized, input.mode, selectedProviderId, now);
    this.cache.delete(normalized);
    return { mode: input.mode, selectedProviderId, updatedAt: now };
  }
}

export { WebSearchSettingsService };
