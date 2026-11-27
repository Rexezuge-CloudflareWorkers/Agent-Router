/**
Third-party search providers are a separate registry from model providers:
they run through WebSearchClient rather than the LLM proxy. The shapes stay
deliberately parallel to the model provider/key metadata so both surfaces
have the same management semantics (priority, caps, cooldown, health).
*/

export type SearchProviderKind = 'BRAVE' | 'TAVILY';

export type SearchProviderStatus = 'active' | 'disabled';

export type SearchProviderKeyStatus = 'active' | 'degraded' | 'exhausted' | 'disabled';

export interface SearchProviderMetadata {
  id: string;
  userEmail: string;
  kind: SearchProviderKind;
  name: string;
  status: SearchProviderStatus;
  createdAt: number;
  updatedAt: number | null;
}

export interface SearchProviderKeyMetadata {
  id: string;
  providerId: string;
  userEmail: string;
  name: string;
  keyHint: string | null;
  requestLimit: number | null;
  usedRequests: number;
  resetAt: number | null;
  priority: number;
  status: SearchProviderKeyStatus;
  cooldownUntil: number | null;
  consecutiveFailures: number;
  lastUsedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number | null;
}

export const SEARCH_PROVIDER_KINDS: readonly SearchProviderKind[] = ['BRAVE', 'TAVILY'];

export function isSearchProviderKind(value: unknown): value is SearchProviderKind {
  return typeof value === 'string' && (SEARCH_PROVIDER_KINDS as readonly string[]).includes(value);
}
