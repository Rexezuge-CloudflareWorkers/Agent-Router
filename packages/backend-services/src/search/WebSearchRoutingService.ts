import { asRecord } from '@agent-router/provider-clients/shared/coercion';
import { BadRequestError } from '@rexezuge/errors';
import type { ProxyRequest, ProxySuccess, RouterService } from '../router';
import { WebSearchClient } from './WebSearchClient';
import { WebSearchSettingsService } from './WebSearchSettingsService';
import {
  appendToolResult,
  bufferedBody,
  bufferedUpstreamPath,
  findSearchToolCall,
  injectSearchTool,
  stripNativeSearch,
} from './requestShapes';
import { injectCitations, toSse } from './responseShapes';
import type { SearchEndpoint, SearchResult } from './types';

interface WebSearchRoutingDeps {
  settings: WebSearchSettingsService;
  router: RouterService;
  searchClient?: WebSearchClient;
}

/**
Single orchestration point for web search. It sits above `RouterService`:
each upstream call still gets normal key selection, failover and metering,
while this service owns mode selection, body rewrites and response shaping.
*/
class WebSearchRoutingService {
  private readonly settings: WebSearchSettingsService;
  private readonly router: RouterService;
  private readonly searchClient: WebSearchClient;

  constructor(deps: WebSearchRoutingDeps) {
    this.settings = deps.settings;
    this.router = deps.router;
    this.searchClient = deps.searchClient ?? new WebSearchClient();
  }

  public async proxy(request: ProxyRequest, endpoint: SearchEndpoint): Promise<ProxySuccess> {
    const settings = await this.settings.getSettings(request.userEmail);
    if (settings.mode === 'native') {
      if (request.providerKind === 'COMMAND_CODE') {
        throw new BadRequestError('Native web search is not available on Command Code; add an OpenAI, Anthropic or Gemini provider.');
      }
      return this.router.proxy(request);
    }

    const body = { ...asRecord(request.upstreamBody) };
    if (settings.mode === 'none') {
      if (stripNativeSearch(body, endpoint)) return this.router.proxy(this.withBody(request, body));
      return this.router.proxy(request);
    }

    // Third-party mode: force buffered upstream calls so the tool call can be
    // detected, then render the client's native shape at the end.
    stripNativeSearch(body, endpoint);
    injectSearchTool(body, endpoint);
    const first = await this.router.proxy(
      this.withBody(request, bufferedBody(body, endpoint), bufferedUpstreamPath(endpoint, request.upstreamPath), false),
    );
    const payload = this.parse(first);
    if (!payload) return this.deliver(first, endpoint, request.clientStream === true, []);
    const call = findSearchToolCall(payload, endpoint);
    if (!call) return this.deliver(first, endpoint, request.clientStream === true, []);

    let results: SearchResult[] = [];
    let searchError: string | undefined;
    try {
      const credential = await this.settings.decryptApiKey(request.userEmail);
      results = await this.searchClient.search(credential.provider, call.query, credential.apiKey, request.signal);
    } catch (error) {
      // A failed search degrades to a tool result the model can explain,
      // instead of turning an otherwise valid completion into a hard error.
      searchError = error instanceof Error ? error.message.slice(0, 200) : 'Unknown search error';
    }
    appendToolResult(body, endpoint, call, this.searchClient.formatToolResult(results, searchError));
    const second = await this.router.proxy(
      this.withBody(request, bufferedBody(body, endpoint), bufferedUpstreamPath(endpoint, request.upstreamPath), false),
    );
    return this.deliver(second, endpoint, request.clientStream === true, results);
  }

  private parse(result: ProxySuccess): unknown {
    if (result.status < 200 || result.status >= 300 || !result.bodyText) return null;
    try {
      const payload: unknown = JSON.parse(result.bodyText);
      return payload && typeof payload === 'object' ? payload : null;
    } catch {
      return null;
    }
  }

  private withBody(
    request: ProxyRequest,
    body: Record<string, unknown>,
    upstreamPath = request.upstreamPath,
    clientStream?: boolean,
  ): ProxyRequest {
    const text = JSON.stringify(body);
    return {
      ...request,
      upstreamPath,
      upstreamBody: body,
      rawBodyText: text,
      bodyBytes: new TextEncoder().encode(text).byteLength,
      clientStream: clientStream ?? request.clientStream,
    };
  }

  private deliver(result: ProxySuccess, endpoint: SearchEndpoint, streaming: boolean, results: SearchResult[]): ProxySuccess {
    const payload = this.parse(result);
    if (!payload) return { ...result, contentType: 'application/json' };
    if (!streaming) {
      return {
        ...result,
        bodyText: JSON.stringify(results.length > 0 ? injectCitations(payload, results, endpoint) : payload),
        contentType: 'application/json',
      };
    }
    return {
      ...result,
      bodyText: toSse(payload, results, endpoint),
      contentType: endpoint === 'gemini' ? 'application/json' : 'text/event-stream',
    };
  }
}

export { WebSearchRoutingService };
export type { WebSearchRoutingDeps };
