import type { WebSearchSettingsDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';

type WebSearchMode = 'none' | 'native' | 'third_party';

type SearchProviderKind = 'BRAVE' | 'TAVILY';

type SearchEndpoint = 'chat' | 'responses' | 'anthropic' | 'gemini';

interface WebSearchSettings {
  mode: WebSearchMode;
  provider: SearchProviderKind | null;
  keyHint: string | null;
  updatedAt: number | null;
}

interface WebSearchConfig extends WebSearchSettings {
  encryptedApiKey: string | null;
}

interface WebSearchSettingsInput {
  mode: WebSearchMode;
  provider?: string | null;
  apiKey?: string | null;
}

interface WebSearchSettingsEnv {
  DB: D1Queryable;
  WEB_SEARCH_ENCRYPTION_SECRET?: { get(): Promise<string> };
}

interface WebSearchSettingsDeps {
  dao?: () => Promise<WebSearchSettingsDAO>;
  masterKey?: () => Promise<string>;
  now?: () => number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchToolCall {
  id: string;
  query: string;
}

const WEB_SEARCH_MODES: ReadonlySet<string> = new Set(['none', 'native', 'third_party']);
const SEARCH_PROVIDER_KINDS: ReadonlySet<string> = new Set(['BRAVE', 'TAVILY']);
const WEB_SEARCH_TOOL_NAME = 'web_search';
const MAX_SEARCH_RESULTS = 5;
/**
Upstream calls allowed in the tool loop (initial call + two searches).
*/
const MAX_TOOL_ROUNDS = 3;

function isWebSearchMode(value: unknown): value is WebSearchMode {
  return typeof value === 'string' && WEB_SEARCH_MODES.has(value);
}

function isSearchProviderKind(value: unknown): value is SearchProviderKind {
  return typeof value === 'string' && SEARCH_PROVIDER_KINDS.has(value);
}

export {
  MAX_SEARCH_RESULTS,
  MAX_TOOL_ROUNDS,
  SEARCH_PROVIDER_KINDS,
  WEB_SEARCH_MODES,
  WEB_SEARCH_TOOL_NAME,
  isSearchProviderKind,
  isWebSearchMode,
};
export type {
  SearchEndpoint,
  SearchProviderKind,
  SearchResult,
  SearchToolCall,
  WebSearchConfig,
  WebSearchMode,
  WebSearchSettings,
  WebSearchSettingsDeps,
  WebSearchSettingsEnv,
  WebSearchSettingsInput,
};
