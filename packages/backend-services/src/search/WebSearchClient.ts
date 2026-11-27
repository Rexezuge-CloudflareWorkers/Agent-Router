import { asArray, asRecord, asString } from '@agent-router/provider-clients/shared/coercion';
import { MAX_SEARCH_RESULTS } from './types';
import type { SearchProviderKind, SearchResult } from './types';

const DEFAULT_TIMEOUT_MS = 10_000;
const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search';
const TAVILY_URL = 'https://api.tavily.com/search';

interface WebSearchClientDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function truncate(value: string, length: number): string {
  return value.length > length ? value.slice(0, length) : value;
}

function normalizeResults(raw: unknown, kind: SearchProviderKind): SearchResult[] {
  const items = kind === 'BRAVE' ? asArray(asRecord(asRecord(raw).web).results) : asArray(asRecord(raw).results);
  const results: SearchResult[] = [];
  for (const item of items) {
    const record = asRecord(item);
    const url = asString(record.url).trim();
    if (!url.startsWith('https://') && !url.startsWith('http://')) continue;
    const title = asString(record.title).trim();
    results.push({
      title: truncate(title || url, 200),
      url: truncate(url, 2000),
      snippet: truncate(asString(kind === 'BRAVE' ? record.description : record.content).trim(), 1000),
    });
    if (results.length === MAX_SEARCH_RESULTS) break;
  }
  return results;
}

/**
Thin, provider-agnostic client for the two supported third-party search
APIs. Credentials are passed to the upstream only; error messages never
include the request body or API key.
*/
class WebSearchClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(deps: WebSearchClientDeps = {}) {
    // Bind fetch: Workers' native fetch is this-sensitive.
    // eslint-disable-next-line unicorn/no-unnecessary-global-this
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  public async search(kind: SearchProviderKind, query: string, apiKey: string, signal?: AbortSignal): Promise<SearchResult[]> {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response =
        kind === 'BRAVE'
          ? await this.fetchImpl(`${BRAVE_URL}?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}`, {
              headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
              signal: controller.signal,
            })
          : await this.fetchImpl(TAVILY_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                api_key: apiKey,
                query,
                max_results: MAX_SEARCH_RESULTS,
                search_depth: 'basic',
                include_answer: false,
              }),
              signal: controller.signal,
            });
      if (!response.ok) throw new Error(`Search provider returned ${response.status}`);
      const payload: unknown = await response.json();
      return normalizeResults(payload, kind);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
  Text handed to the model as the `web_search` tool result. `startIndex`
  keeps numbering stable when several search rounds feed one final answer.
  */
  public formatToolResult(results: SearchResult[], error?: string, startIndex = 0): string {
    if (error) return `Web search failed: ${error}. Answer with your existing knowledge and say that search was unavailable.`;
    if (results.length === 0) return 'Web search returned no results. Answer with your existing knowledge.';
    const lines = results.map((result, index) => {
      const reference = `[${startIndex + index + 1}]`;
      return `${reference} ${result.title}\nURL: ${result.url}\n${result.snippet}`.trim();
    });
    return (
      `Web search results:\n${lines.join('\n\n')}\n\n` +
      `Every factual claim must include at least one bracketed citation, e.g. [${startIndex + 1}]. ` +
      'Use only the numbers above.'
    );
  }
}

export { BRAVE_URL, DEFAULT_TIMEOUT_MS, TAVILY_URL, WebSearchClient, normalizeResults };
