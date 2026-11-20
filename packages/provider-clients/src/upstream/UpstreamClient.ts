import type { ProviderKind } from '@agent-router/shared';
import { getAdapter } from '../adapters/registry';
import { codexAdapter } from '../adapters/codex';
import type { ParsedUsage, UpstreamCall } from '../adapters/types';
import { isRecord } from '../shared/coercion';
import { parseSseJsonLines } from '../shared/sse';

function buildUpstreamCall(
  kind: ProviderKind,
  baseUrl: string | null,
  path: string,
  secret: string,
  body: unknown,
  anthropicVersion = '2023-06-01',
  rawBody?: string,
): UpstreamCall {
  const adapter = getAdapter(kind);
  if (!adapter) {
    // Only Command Code lacks an adapter, and it never reaches this path; a
    // silent fallback would send OpenAI-shaped traffic to the wrong upstream.
    throw new Error(`No upstream adapter for provider kind ${kind}`);
  }
  return adapter.buildCall({ baseUrl, path, secret, body, anthropicVersion, rawBody });
}

/**
Extracts human-readable text from an HTML error page (the Codex backend
answers failed auth/edge checks with its login page instead of JSON).
Script/style content is dropped so the result is page copy, not CSS.
*/
function extractHtmlPageText(html: string): string {
  return html
    .replaceAll(/<script\b[^<>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replaceAll(/<style\b[^<>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replaceAll(/<[^<>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
Extracts the final response object from a Codex SSE stream (the
`response.completed` event payload) so non-streaming clients receive plain
JSON. The backend sometimes snapshots `output` empty, so output is rebuilt
from `response.output_item.done` events (falling back to accumulated text
deltas) when the snapshot carries none. Returns null when no completed
event is present.
*/
function extractCodexCompletedResponse(sseText: string): string | null {
  let completed: Record<string, unknown> | null = null;
  const items: unknown[] = [];
  let deltaText = '';
  for (const event of parseSseJsonLines(sseText) as Array<{
    type?: unknown;
    delta?: unknown;
    item?: unknown;
    response?: unknown;
  }>) {
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') deltaText += event.delta;
    else if (event.type === 'response.output_item.done' && event.item !== undefined) items.push(event.item);
    else if (event.type === 'response.completed' && typeof event.response === 'object' && event.response !== null) {
      completed = event.response as Record<string, unknown>;
    }
  }
  if (completed === null) return null;
  if (!Array.isArray(completed['output']) || (completed['output'] as unknown[]).length === 0) {
    if (items.length > 0) completed = { ...completed, output: items };
    else if (deltaText) {
      completed = { ...completed, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: deltaText }] }] };
    }
  }
  return JSON.stringify(completed);
}

function buildCodexCall(baseUrl: string | null, path: string, accessToken: string, accountId: string | null, body: unknown): UpstreamCall {
  // Required by the Codex backend: the Responses beta gate plus the CLI
  // originator (same values sent by the official Codex CLI and the
  // opencode Codex plugins). Without them the backend rejects calls with
  // an HTML 400 instead of reaching the model.
  const call = codexAdapter.buildCall({ baseUrl, path, secret: accessToken, body });
  if (accountId) call.headers['ChatGPT-Account-Id'] = accountId;
  return call;
}

function parseUsage(kind: ProviderKind, responseJson: unknown): ParsedUsage {
  const adapter = getAdapter(kind);
  return adapter ? adapter.parseUsage(responseJson) : { promptTokens: 0, completionTokens: 0, estimated: true };
}

interface UsageTap {
  stream: ReadableStream<Uint8Array>;
  usage: Promise<ParsedUsage>;
}

/**
Relays an upstream byte stream untouched while tracking usage from its SSE
frames. Streaming clients are never buffered to account for tokens: every
chunk is forwarded before it is inspected, and only frames that contain a
`usage` object are parsed. Cancelling the relay settles the usage promise so
the ledger is still written when a client disconnects.
*/
function tapUsageStream(body: ReadableStream<Uint8Array>): UsageTap {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let sawUsage = false;
  let settled = false;
  let resolveUsage!: (usage: ParsedUsage) => void;
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
  const usage = new Promise<ParsedUsage>((resolve) => {
    resolveUsage = resolve;
  });

  const observe = (record: Record<string, unknown>): void => {
    for (const container of [record, record.response, record.message]) {
      if (!isRecord(container) || !isRecord(container.usage)) continue;
      const source = container.usage;
      const input =
        typeof source.input_tokens === 'number'
          ? source.input_tokens
          : typeof source.prompt_tokens === 'number'
            ? source.prompt_tokens
            : null;
      const output =
        typeof source.output_tokens === 'number'
          ? source.output_tokens
          : typeof source.completion_tokens === 'number'
            ? source.completion_tokens
            : null;
      if (input === null && output === null) continue;
      sawUsage = true;
      if (input !== null) promptTokens = Math.max(promptTokens, input);
      if (output !== null) completionTokens = Math.max(completionTokens, output);
    }
  };

  const consumeLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:') || !trimmed.includes('"usage"')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const parsed: unknown = JSON.parse(payload);
      if (isRecord(parsed)) observe(parsed);
    } catch {
      // Non-JSON SSE frames carry no usage.
    }
  };

  const feed = (text: string): void => {
    buffer += text;
    const lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline === -1) return;
    const complete = buffer.slice(0, lastNewline);
    buffer = buffer.slice(lastNewline + 1);
    for (const line of complete.split('\n')) consumeLine(line);
  };

  const settle = (): void => {
    if (settled) return;
    settled = true;
    if (buffer.trim()) consumeLine(buffer);
    buffer = '';
    resolveUsage({ promptTokens, completionTokens, estimated: !sawUsage });
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const read = await reader.read();
        if (read.done) {
          feed(decoder.decode());
          settle();
          controller.close();
          return;
        }
        if (read.value) {
          controller.enqueue(read.value);
          feed(decoder.decode(read.value, { stream: true }));
        }
      } catch (error) {
        settle();
        controller.error(error);
      }
    },
    cancel(reason) {
      settle();
      void reader.cancel(reason).catch(() => {});
    },
  });

  return { stream, usage };
}

export { buildUpstreamCall, buildCodexCall, parseUsage, extractCodexCompletedResponse, extractHtmlPageText, tapUsageStream };
export { isRetryableStatus } from '../shared/retryable';
export { CODEX_BASE_URL, resolveCodexBase } from '../adapters/codex';
export type { UpstreamCall, ParsedUsage } from '../adapters/types';
export type { UsageTap };
