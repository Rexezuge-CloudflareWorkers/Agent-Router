import type { ProviderKind } from '@agent-router/shared';

interface UpstreamCall {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function buildUpstreamCall(
  kind: ProviderKind,
  baseUrl: string | null,
  path: string,
  secret: string,
  body: unknown,
  anthropicVersion = '2023-06-01',
): UpstreamCall {
  const payload = JSON.stringify(body ?? {});
  if (kind === 'ANTHROPIC') {
    const base = (baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    return {
      url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
      headers: { 'content-type': 'application/json', 'x-api-key': secret, 'anthropic-version': anthropicVersion },
      body: payload,
    };
  }
  if (kind === 'GEMINI') {
    const base = (baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const separator = path.includes('?') ? '&' : '?';
    return {
      url: `${base}${path.startsWith('/') ? path : `/${path}`}${separator}key=${encodeURIComponent(secret)}`,
      headers: { 'content-type': 'application/json' },
      body: payload,
    };
  }
  const base = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
    body: payload,
  };
}

// Codex OAuth (ChatGPT subscription) tokens are honored by the Codex
// backend, not the OpenAI platform API. Opencode rewrites both
// /v1/responses and /chat/completions to this endpoint.
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
// Rows created before the backend correction pin the platform endpoint;
// keep calling the Codex backend for them instead of 429ing upstream.
const LEGACY_CODEX_BASE_URLS = new Set(['https://api.openai.com/v1', 'https://api.openai.com/v1/']);

function resolveCodexBase(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/$/, '');
  return !trimmed || LEGACY_CODEX_BASE_URLS.has(trimmed) || LEGACY_CODEX_BASE_URLS.has(`${trimmed}/`) ? CODEX_BASE_URL : trimmed;
}

/**
 * Normalizes a Responses body for the Codex backend: `input` must be a list
 * of blocks (plain strings are wrapped as a single user message), `store`
 * must be false (the backend retains nothing for ChatGPT-backed calls), and
 * `stream` must be true (the backend only serves SSE). The gateway converts
 * back to JSON for non-streaming clients. Every other field passes through.
 */
function normalizeCodexBody(body: unknown): unknown {
  const base = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const record: Record<string, unknown> = { ...base, store: false, stream: true };
  if (typeof record.input === 'string') {
    record.input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: record.input }] }];
  }
  return record;
}

/**
 * Extracts human-readable text from an HTML error page (the Codex backend
 * answers failed auth/edge checks with its login page instead of JSON).
 * Script/style content is dropped so the result is page copy, not CSS.
 */
function extractHtmlPageText(html: string): string {
  return html
    .replaceAll(/<script[^<>]*>[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[^<>]*>[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^<>]*>/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * Extracts the final response object from a Codex SSE stream (the
 * `response.completed` event payload) so non-streaming clients receive plain
 * JSON. The backend sometimes snapshots `output` empty, so output is rebuilt
 * from `response.output_item.done` events (falling back to accumulated text
 * deltas) when the snapshot carries none. Returns null when no completed
 * event is present.
 */
function extractCodexCompletedResponse(sseText: string): string | null {
  let completed: Record<string, unknown> | null = null;
  const items: unknown[] = [];
  let deltaText = '';
  for (const line of sseText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const event = JSON.parse(payload) as { type?: unknown; delta?: unknown; item?: unknown; response?: unknown };
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') deltaText += event.delta;
      else if (event.type === 'response.output_item.done' && event.item !== undefined) items.push(event.item);
      else if (event.type === 'response.completed' && typeof event.response === 'object' && event.response !== null) {
        completed = event.response as Record<string, unknown>;
      }
    } catch {
      // Ignore non-JSON SSE payloads (comments, heartbeat frames).
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
  const payload = JSON.stringify(normalizeCodexBody(body));
  const base = resolveCodexBase(baseUrl);
  // Required by the Codex backend: the Responses beta gate plus the CLI
  // originator (same values sent by the official Codex CLI and the
  // opencode Codex plugins). Without them the backend rejects calls with
  // an HTML 400 instead of reaching the model.
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${accessToken}`,
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
  };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;
  return {
    url: `${base}${path.startsWith('/') ? path : `/${path}`}`,
    headers,
    body: payload,
  };
}

interface ParsedUsage {
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

function parseUsage(kind: ProviderKind, responseJson: unknown): ParsedUsage {
  try {
    const root = responseJson as Record<string, unknown>;
    const usage = root?.usage as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== 'object') return { promptTokens: 0, completionTokens: 0, estimated: true };
    if (kind === 'ANTHROPIC') {
      const prompt = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
      const completion = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
      return { promptTokens: prompt, completionTokens: completion, estimated: false };
    }
    if (kind === 'OPENAI_CODEX') {
      const prompt = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
      const completion = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
      return prompt === 0 && completion === 0 ? { promptTokens: 0, completionTokens: 0, estimated: true } : { promptTokens: prompt, completionTokens: completion, estimated: false };
    }
    const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
    const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
    if (prompt === 0 && completion === 0) {
      const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : 0;
      return { promptTokens: total, completionTokens: 0, estimated: total === 0 };
    }
    return { promptTokens: prompt, completionTokens: completion, estimated: false };
  } catch {
    return { promptTokens: 0, completionTokens: 0, estimated: true };
  }
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

export { buildUpstreamCall, buildCodexCall, parseUsage, isRetryableStatus, CODEX_BASE_URL, extractCodexCompletedResponse, extractHtmlPageText };
export type { UpstreamCall, ParsedUsage };
