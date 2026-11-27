import { describe, expect, it, vi } from 'vitest';
import { WebSearchClient, normalizeResults } from '@agent-router/backend-services/search/WebSearchClient';

function response(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: { 'content-type': 'application/json' } });
}

describe('WebSearchClient', () => {
  it('queries Brave with a subscription token and normalizes web results', async () => {
    const fetchImpl = vi.fn(async () =>
      response({
        web: {
          results: [
            { title: 'Brave Result', url: 'https://example.com/a', description: 'A snippet' },
            { title: 'Invalid', url: 'not-a-url', description: 'skip' },
          ],
        },
      }),
    );
    const client = new WebSearchClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await client.search('BRAVE', 'cloudflare workers', 'brave-key');
    expect(results).toEqual([{ title: 'Brave Result', url: 'https://example.com/a', snippet: 'A snippet' }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('q=cloudflare%20workers');
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('brave-key');
  });

  it('posts to Tavily with the key in the body and normalizes content', async () => {
    const fetchImpl = vi.fn(async () =>
      response({ results: [{ title: 'Tavily Result', url: 'https://example.com/b', content: 'Another snippet' }] }),
    );
    const client = new WebSearchClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const results = await client.search('TAVILY', 'web search', 'tavily-key');
    expect(results[0].snippet).toBe('Another snippet');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ api_key: 'tavily-key', query: 'web search', max_results: 5 });
  });

  it('reports upstream status without echoing credentials', async () => {
    const fetchImpl = vi.fn(async () => response({ error: 'bad key brave-secret-1234' }, 401));
    const client = new WebSearchClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(client.search('BRAVE', 'query', 'brave-secret-1234')).rejects.toThrow('Search provider returned 401');
  });

  it('formats numbered results and a degraded error result', () => {
    const client = new WebSearchClient();
    const results = normalizeResults({ results: [{ title: 'One', url: 'https://a.test', content: 'text' }] }, 'TAVILY');
    expect(client.formatToolResult(results)).toContain('[1] One');
    expect(client.formatToolResult(results)).toContain('Every factual claim must include');
    expect(client.formatToolResult(results, undefined, 4)).toContain('[5] One');
    expect(client.formatToolResult(results, 'timeout')).toContain('Web search failed: timeout');
  });
});
