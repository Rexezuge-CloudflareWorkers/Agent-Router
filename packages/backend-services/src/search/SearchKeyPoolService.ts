import type { SearchProviderKeyDAO, SearchProviderKeyRow } from '@agent-router/backend-data/dao';
import { AppConfiguration } from '@agent-router/backend-runtime/config';
import { TimestampUtil } from '@rexezuge/shared';
import { isSearchProviderKind } from '@agent-router/shared';
import type { SearchProviderKind } from '@agent-router/shared';
import { cooldownUntilFor } from '../router/keyHealth';
import type { SearchProviderKeyService } from './SearchProviderKeyService';

interface SearchKeyPoolDeps {
  keyDAO?: () => Promise<SearchProviderKeyDAO>;
  keyService?: () => SearchProviderKeyService;
  config?: AppConfiguration;
  now?: () => number;
}

export interface SearchKeyCandidate {
  keyId: string;
  providerId: string;
  kind: SearchProviderKind;
  apiKey: string;
  row: SearchProviderKeyRow;
}

/**
Selects search credentials across every active search provider and records
the outcome of each attempt. This is the search analogue of RouterService's
failover loop: caps exhaust keys, 429 degrades them, other failures apply
exponential cooldown and disable at the threshold.
*/
class SearchKeyPoolService {
  private readonly deps: Required<SearchKeyPoolDeps>;

  constructor(env: unknown, deps: SearchKeyPoolDeps = {}) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    this.deps = {
      keyDAO:
        deps.keyDAO ??
        (() => {
          throw new Error('SearchProviderKeyDAO is not configured for this pool');
        }),
      keyService:
        deps.keyService ??
        (() => {
          throw new Error('SearchProviderKeyService is not configured for this pool');
        }),
      config,
      now: deps.now ?? (() => TimestampUtil.getCurrentUnixTimestampInSeconds()),
    };
  }

  /**
  Candidates in failover order, preferred provider first.
  */
  public async select(userEmail: string, preferredProviderId: string | null): Promise<SearchKeyCandidate[]> {
    const now = this.deps.now();
    const rows = await (await this.deps.keyDAO()).listSelectableByUser(userEmail, preferredProviderId, now);
    const dao = await this.deps.keyDAO();
    const candidates: SearchKeyCandidate[] = [];
    for (const row of rows) {
      if (!isSearchProviderKind(row.provider_kind)) continue;
      if (row.request_limit !== null && row.used_requests >= row.request_limit) {
        await dao.markExhausted(row.id, now).catch(() => {});
        continue;
      }
      let apiKey: string;
      try {
        apiKey = await this.deps.keyService().decryptSecret(row.id, userEmail);
      } catch {
        // One undecryptable credential must not disable the whole pool; other
        // providers may still be healthy.
        continue;
      }
      candidates.push({ keyId: row.id, providerId: row.provider_id, kind: row.provider_kind, apiKey, row });
      if (candidates.length >= this.deps.config.getProxyMaxAttempts()) break;
    }
    return candidates;
  }

  public async recordSuccess(keyId: string): Promise<void> {
    await (await this.deps.keyDAO()).recordSuccess(keyId, this.deps.now()).catch(() => {});
  }

  public async recordFailure(candidate: SearchKeyCandidate, outcome: { status?: number; message: string }): Promise<void> {
    const dao = await this.deps.keyDAO();
    const now = this.deps.now();
    const reason = outcome.message.slice(0, 500);
    if (outcome.status === 429) {
      await dao.markDegraded(candidate.keyId, reason, now).catch(() => {});
      return;
    }
    const failures = candidate.row.consecutive_failures + 1;
    const cooldownUntil = cooldownUntilFor(failures, now, {
      baseMs: this.deps.config.getKeyCooldownBaseMs(),
      disableAfter: this.deps.config.getKeyMaxConsecutiveFailures(),
    });
    await dao.recordFailure(candidate.keyId, reason, cooldownUntil, now).catch(() => {});
    // An invalid credential cannot recover without a rotation; a 401/403 is
    // terminal for this key even before the generic failure threshold.
    if (outcome.status === 401 || outcome.status === 403 || failures >= this.deps.config.getKeyMaxConsecutiveFailures()) {
      await dao.disable(candidate.keyId, now).catch(() => {});
    }
  }
}

export { SearchKeyPoolService };
export type { SearchKeyPoolDeps };
