import type { SearchProviderDAO, WebSearchSettingsDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';

type SearchEndpoint = 'chat' | 'responses' | 'anthropic' | 'gemini';

type WebSearchMode = 'none' | 'native' | 'third_party';

interface WebSearchSettings {
  mode: WebSearchMode;
  /**
  null = auto: fail over across all active search providers.
  */
  selectedProviderId: string | null;
  updatedAt: number | null;
}

type WebSearchConfig = WebSearchSettings;

interface WebSearchSettingsInput {
  mode: WebSearchMode;
  selectedProviderId?: string | null;
}

interface WebSearchSettingsEnv {
  DB: D1Queryable;
}

interface WebSearchSettingsDeps {
  dao?: () => Promise<WebSearchSettingsDAO>;
  searchProviderDAO?: () => Promise<SearchProviderDAO>;
  now?: () => number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearchToolCall {
  /**
  Tool call id used by function_call_output (call_id on the Responses API).
  */
  id: string;
  /**
  Original assistant item id, needed when replaying a Responses function_call.
  */
  itemId?: string;
  query: string;
}

const WEB_SEARCH_MODES: ReadonlySet<string> = new Set(['none', 'native', 'third_party']);
const WEB_SEARCH_TOOL_NAME = 'web_search';
const MAX_SEARCH_RESULTS = 5;
/**
Upstream calls allowed in the tool loop (initial call + two searches).
*/
const MAX_TOOL_ROUNDS = 3;

function isWebSearchMode(value: unknown): value is WebSearchMode {
  return typeof value === 'string' && WEB_SEARCH_MODES.has(value);
}

export { isWebSearchMode, MAX_SEARCH_RESULTS, MAX_TOOL_ROUNDS, WEB_SEARCH_MODES, WEB_SEARCH_TOOL_NAME };
export type {
  SearchEndpoint,
  SearchResult,
  SearchToolCall,
  WebSearchConfig,
  WebSearchMode,
  WebSearchSettings,
  WebSearchSettingsDeps,
  WebSearchSettingsEnv,
  WebSearchSettingsInput,
};

export { isSearchProviderKind, type SearchProviderKind } from '@agent-router/shared';
