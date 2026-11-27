import { asRecord } from '@agent-router/provider-clients/shared/coercion';
import { BadRequestError } from '@rexezuge/errors';
import type { ProxyRequest, ProxySuccess, RouterService } from '../router';
import { WebSearchClient } from './WebSearchClient';
import { WebSearchSettingsService } from './WebSearchSettingsService';
import {
  appendAnswerDirective,
  appendToolResults,
  bufferedBody,
  bufferedUpstreamPath,
  findSearchToolCalls,
  injectSearchTool,
  removeSearchTool,
  stripNativeSearch,
} from './requestShapes';
import { injectCitations, toSse } from './responseShapes';
import { MAX_TOOL_ROUNDS } from './types';
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

    // Third-party mode: force buffered upstream calls so tool calls can be
    // detected deterministically, then render the client's native shape once
    // the model stops searching.
    stripNativeSearch(body, endpoint);
    injectSearchTool(body, endpoint);
    let response = await this.callUpstream(request, body, endpoint);
    let rounds = 1;
    const results: SearchResult[] = [];
    let credential: { provider: 'BRAVE' | 'TAVILY'; apiKey: string } | undefined;

    while (rounds < MAX_TOOL_ROUNDS) {
      const payload = this.parse(response);
      if (!payload) break;
      const calls = findSearchToolCalls(payload, endpoint);
      if (calls.length === 0) break;

      const contents: string[] = [];
      for (const call of calls) {
        try {
          credential ??= await this.settings.decryptApiKey(request.userEmail);
          const found = await this.searchClient.search(credential.provider, call.query, credential.apiKey, request.signal);
          const startIndex = results.length;
          results.push(...found);
          contents.push(this.searchClient.formatToolResult(found, undefined, startIndex));
        } catch (error) {
          // A failed search degrades to a tool result the model can explain,
          // instead of turning an otherwise valid completion into a hard error.
          const message = error instanceof Error ? error.message.slice(0, 200) : 'Unknown search error';
          contents.push(this.searchClient.formatToolResult([], message));
        }
      }
      appendToolResults(body, endpoint, calls, contents);
      response = await this.callUpstream(request, body, endpoint);
      rounds += 1;
    }

    // If the model still wants to search after the cap, remove our tool and
    // ask it to answer from the collected results. Without this the client
    // would receive a tool call instead of an answer.
    const tail = this.parse(response);
    if (tail && findSearchToolCalls(tail, endpoint).length > 0) {
      removeSearchTool(body, endpoint);
      appendAnswerDirective(body, endpoint);
      response = await this.callUpstream(request, body, endpoint);
    }

    return this.deliver(response, endpoint, request.clientStream === true, results);
  }

  private callUpstream(request: ProxyRequest, body: Record<string, unknown>, endpoint: SearchEndpoint): Promise<ProxySuccess> {
    return this.router.proxy(
      this.withBody(request, bufferedBody(body, endpoint), bufferedUpstreamPath(endpoint, request.upstreamPath), false),
    );
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
