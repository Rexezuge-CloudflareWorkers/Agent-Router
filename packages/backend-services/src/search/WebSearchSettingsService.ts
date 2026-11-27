import { WebSearchSettingsDAO } from '@agent-router/backend-data/dao';
import { BadRequestError } from '@rexezuge/errors';
import { TimestampUtil } from '@rexezuge/shared';
import { KeyCrypto } from '../provider/KeyCrypto';
import { isSearchProviderKind, isWebSearchMode } from './types';
import type {
  SearchProviderKind,
  WebSearchConfig,
  WebSearchSettings,
  WebSearchSettingsDeps,
  WebSearchSettingsEnv,
  WebSearchSettingsInput,
} from './types';

/**
Owns the per-user web search configuration. Secrets are AES-GCM encrypted
with a purpose-specific key derived from the Secrets Store master secret;
only the hint is ever returned to callers.
*/
class WebSearchSettingsService {
  private readonly deps: Required<WebSearchSettingsDeps>;

  constructor(
    private readonly env: WebSearchSettingsEnv,
    deps: WebSearchSettingsDeps = {},
  ) {
    this.deps = {
      dao: deps.dao ?? (() => Promise.resolve(new WebSearchSettingsDAO(this.env.DB))),
      masterKey:
        deps.masterKey ??
        (() => {
          if (!this.env.WEB_SEARCH_ENCRYPTION_SECRET) throw new BadRequestError('Web search encryption is not configured');
          return this.env.WEB_SEARCH_ENCRYPTION_SECRET.get();
        }),
      now: deps.now ?? (() => TimestampUtil.getCurrentUnixTimestampInSeconds()),
    };
  }

  public async getSettings(userEmail: string): Promise<WebSearchSettings> {
    const config = await this.getConfig(userEmail);
    return {
      mode: config.mode,
      provider: config.provider,
      keyHint: config.keyHint,
      updatedAt: config.updatedAt,
    };
  }

  public async getConfig(userEmail: string): Promise<WebSearchConfig> {
    const row = await (await this.deps.dao()).getByEmail(userEmail.toLowerCase());
    if (!row) return { mode: 'none', provider: null, keyHint: null, updatedAt: null, encryptedApiKey: null };
    return {
      mode: isWebSearchMode(row.mode) ? row.mode : 'none',
      provider: isSearchProviderKind(row.provider) ? row.provider : null,
      keyHint: row.key_hint,
      updatedAt: row.updated_at,
      encryptedApiKey: row.encrypted_api_key,
    };
  }

  /**
  Proxy-only: decrypts the credential for an actual search request.
  */
  public async decryptApiKey(userEmail: string): Promise<{ provider: SearchProviderKind; apiKey: string }> {
    const config = await this.getConfig(userEmail);
    if (!config.provider || !config.encryptedApiKey) throw new BadRequestError('Web search provider is not configured');
    const apiKey = await KeyCrypto.decrypt(config.encryptedApiKey, await this.deps.masterKey(), 'web-search-keys');
    return { provider: config.provider, apiKey };
  }

  public async saveSettings(userEmail: string, input: WebSearchSettingsInput): Promise<WebSearchSettings> {
    if (!isWebSearchMode(input.mode)) throw new BadRequestError('mode must be one of none, native or third_party');
    const normalizedEmail = userEmail.toLowerCase();
    const current = await this.getConfig(normalizedEmail);

    let provider: SearchProviderKind | null = null;
    let encryptedApiKey: string | null = null;
    let keyHint: string | null = null;

    if (input.mode === 'third_party') {
      const candidate = input.provider?.trim().toUpperCase() ?? current.provider ?? '';
      if (!isSearchProviderKind(candidate)) throw new BadRequestError('provider must be one of BRAVE or TAVILY');
      provider = candidate;
      const rawKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
      if (rawKey) {
        if (rawKey.length > 512) throw new BadRequestError('apiKey is too long');
        encryptedApiKey = await KeyCrypto.encrypt(rawKey, await this.deps.masterKey(), 'web-search-keys');
        keyHint = KeyCrypto.hintFor(rawKey);
      } else if (current.provider === provider && current.encryptedApiKey) {
        // Re-saving without a value keeps the existing credential instead of
        // silently turning a configured integration into a broken one.
        encryptedApiKey = current.encryptedApiKey;
        keyHint = current.keyHint;
      } else {
        throw new BadRequestError('apiKey is required for third-party search');
      }
    }

    const now = this.deps.now();
    await (await this.deps.dao()).upsert(normalizedEmail, input.mode, provider, encryptedApiKey, keyHint, now);
    return { mode: input.mode, provider, keyHint, updatedAt: now };
  }
}

export { WebSearchSettingsService };
