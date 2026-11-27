import { asRecord } from '@agent-router/provider-clients/shared/coercion';
import { BadRequestError } from '@rexezuge/errors';
import type { ProxyRequest, ProxySuccess, RouterService } from '../router';
import { SearchProviderError, WebSearchClient } from './WebSearchClient';
import { SearchKeyPoolService } from './SearchKeyPoolService';
import type { WebSearchSettingsService } from './WebSearchSettingsService';
import {
  appendAnswerDirective,
  appendToolResults,
  bufferedBody,
  bufferedUpstreamPath,
  findSearchToolCalls,
  forceSearchTool,
  injectSearchTool,
  removeSearchTool,
  stripNativeSearch,
} from './requestShapes';
import { injectCitations, toSse } from './responseShapes';
import { createStreamAdapter, relayStream } from './stream';
import { MAX_TOOL_ROUNDS } from './types';
import type { SearchEndpoint, SearchResult, WebSearchSettings } from './types';

interface WebSearchRoutingDeps {
  settings: WebSearchSettingsService;
  router: RouterService;
  keyPool: SearchKeyPoolService;
  searchClient?: WebSearchClient;
}

interface SearchOutcome {
  results: SearchResult[];
  error?: string;
}

/**
Single orchestration point for web search. It sits above `RouterService`:
each upstream LLM call still gets normal key selection, failover and
metering, while this service owns mode selection, body rewrites, response
shaping and search-credential failover.
*/
class WebSearchRoutingService {
  private readonly settings: WebSearchSettingsService;
  private readonly router: RouterService;
  private readonly keyPool: SearchKeyPoolService;
  private readonly searchClient: WebSearchClient;

  constructor(deps: WebSearchRoutingDeps) {
    this.settings = deps.settings;
    this.router = deps.router;
    this.keyPool = deps.keyPool;
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

    // Streaming clients must see tokens as they arrive, so the tool loop runs
    // over streamed upstream calls instead of buffering every round. The
    // buffered path below stays in place for non-streaming clients.
    if (request.clientStream === true) return this.proxyStreaming(request, settings, endpoint);

    // Third-party mode: force buffered upstream calls so tool calls can be
    // detected deterministically, then render the client's native shape once
    // the model stops searching.
    stripNativeSearch(body, endpoint);
    injectSearchTool(body, endpoint);
    const restoreToolChoice = forceSearchTool(body, endpoint);
    const previousResponseId = asRecord(request.upstreamBody).previous_response_id;
    const hasPreviousResponse = typeof previousResponseId === 'string' && previousResponseId.length > 0;
    let response = await this.callUpstream(request, body, endpoint);
    let rounds = 1;
    const results: SearchResult[] = [];

    while (rounds < MAX_TOOL_ROUNDS) {
      const payload = this.parse(response);
      if (!payload) break;
      const calls = findSearchToolCalls(payload, endpoint);
      if (calls.length === 0) break;

      const contents: string[] = [];
      for (const call of calls) {
        const outcome = await this.runSearch(call.query, request, settings.selectedProviderId);
        results.push(...outcome.results);
        contents.push(this.searchClient.formatToolResult(outcome.results, outcome.error, results.length - outcome.results.length));
      }
      appendToolResults(body, endpoint, calls, contents, { replayAssistantCall: !hasPreviousResponse || rounds > 1 });
      response = await this.callUpstream(request, body, endpoint);
      rounds += 1;
    }

    // If the model still wants to search after the cap, remove our tool and
    // ask it to answer from the collected results. Without this the client
    // would receive a tool call instead of an answer.
    const tail = this.parse(response);
    if (tail && findSearchToolCalls(tail, endpoint).length > 0) {
      restoreToolChoice();
      removeSearchTool(body, endpoint);
      appendAnswerDirective(body, endpoint);
      response = await this.callUpstream(request, body, endpoint);
    }

    return this.deliver(response, endpoint, false, results);
  }

  /**
  Tool rounds are still detected from complete responses, but the bytes are
  relayed to the client as they arrive. Only terminal frames (and one
  Gemini frame) are held back until the loop knows whether another round is
  needed.
  */
  private async proxyStreaming(request: ProxyRequest, settings: WebSearchSettings, endpoint: SearchEndpoint): Promise<ProxySuccess> {
    const incoming = asRecord(request.upstreamBody);
    const streamOptions = incoming.stream_options;
    const originalToolChoice = incoming.tool_choice;
    const originalToolConfig = incoming.toolConfig;
    const body = { ...incoming };
    stripNativeSearch(body, endpoint);
    const injected = injectSearchTool(body, endpoint);
    forceSearchTool(body, endpoint);
    const restoreToolChoice = (target: Record<string, unknown>): void => {
      if (originalToolChoice === undefined) delete target.tool_choice;
      else target.tool_choice = originalToolChoice;
      if (originalToolConfig === undefined) delete target.toolConfig;
      else target.toolConfig = originalToolConfig;
    };
    const roundBody = this.streamingBody(body, endpoint, streamOptions);
    const adapter = createStreamAdapter(endpoint);
    const encoder = new TextEncoder();
    const results: SearchResult[] = [];
    const previousResponseId = incoming.previous_response_id;
    const hasPreviousResponse = typeof previousResponseId === 'string' && previousResponseId.length > 0;
    const first = await this.callUpstream(request, roundBody, endpoint, true);

    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const emit = (frame: string): void => {
          if (request.signal?.aborted) return;
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            // The client went away mid-generation; the router owns the abort.
          }
        };
        let current = first;
        let currentBody = roundBody;
        try {
          for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
            let rawText = current.bodyText ?? '';
            let sawFrames = false;
            if (current.bodyStream) {
              const relayed = await relayStream(current.bodyStream, adapter, emit, request.signal);
              rawText = relayed.rawText;
              sawFrames = relayed.sawFrames;
            }
            let payload = adapter.payload();
            if (!sawFrames && rawText.trim()) {
              try {
                payload = JSON.parse(rawText) as unknown;
              } catch {
                payload = null;
              }
            }
            const calls = payload ? findSearchToolCalls(payload, endpoint) : [];
            if (calls.length === 0 || round === MAX_TOOL_ROUNDS) {
              if (!sawFrames && payload) emit(toSse(payload, results, endpoint));
              else for (const frame of adapter.finish(results)) emit(frame);
              break;
            }

            const contents: string[] = [];
            for (const call of calls) {
              const outcome = await this.runSearch(call.query, request, settings.selectedProviderId);
              results.push(...outcome.results);
              contents.push(this.searchClient.formatToolResult(outcome.results, outcome.error, results.length - outcome.results.length));
            }
            // Never mutate the body handed to an earlier call: tests and
            // usage records keep that snapshot, and each round needs its own
            // request state.
            currentBody = { ...currentBody };
            appendToolResults(currentBody, endpoint, calls, contents, { replayAssistantCall: !hasPreviousResponse || round > 1 });
            if (injected) {
              restoreToolChoice(currentBody);
              removeSearchTool(currentBody, endpoint);
            }
            adapter.nextRound();
            currentBody = this.streamingBody(currentBody, endpoint, streamOptions);
            current = await this.callUpstream(request, currentBody, endpoint, true);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return { ...first, bodyStream: stream, contentType: 'text/event-stream' };
  }

  /**
  Tries the selected provider's keys first, then every other active search
  provider. A failed search still degrades to a tool result the model can
  explain instead of turning an otherwise valid completion into an error.
  */
  private async runSearch(query: string, request: ProxyRequest, preferredProviderId: string | null): Promise<SearchOutcome> {
    const candidates = await this.keyPool.select(request.userEmail, preferredProviderId).catch(() => []);
    if (candidates.length === 0) return { results: [], error: 'Web search is not configured' };
    let lastError = 'Web search is unavailable';
    for (const candidate of candidates) {
      try {
        const found = await this.searchClient.search(candidate.kind, query, candidate.apiKey, request.signal);
        await this.keyPool.recordSuccess(candidate.keyId);
        return { results: found };
      } catch (error) {
        const status = error instanceof SearchProviderError ? error.status : undefined;
        lastError = error instanceof Error ? error.message.slice(0, 200) : 'Unknown search error';
        await this.keyPool.recordFailure(candidate, { status, message: lastError });
        if (request.signal?.aborted) break;
      }
    }
    return { results: [], error: lastError };
  }

  private callUpstream(
    request: ProxyRequest,
    body: Record<string, unknown>,
    endpoint: SearchEndpoint,
    streaming = false,
  ): Promise<ProxySuccess> {
    if (streaming) return this.router.proxy(this.withBody(request, body, request.upstreamPath, true));
    return this.router.proxy(
      this.withBody(request, bufferedBody(body, endpoint), bufferedUpstreamPath(endpoint, request.upstreamPath), false),
    );
  }

  private streamingBody(body: Record<string, unknown>, endpoint: SearchEndpoint, streamOptions: unknown): Record<string, unknown> {
    const copy = { ...body };
    if (endpoint === 'gemini') return copy;
    copy.stream = true;
    if (streamOptions === undefined) delete copy.stream_options;
    else copy.stream_options = streamOptions;
    return copy;
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
      contentType: 'text/event-stream',
    };
  }
}

export { WebSearchRoutingService };
export type { WebSearchRoutingDeps };
