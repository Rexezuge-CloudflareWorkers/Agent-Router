import type { ProviderAdapter } from './types';
import { NO_USAGE } from './types';

const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
// Rows created before the backend correction pin the platform endpoint;
// keep calling the Codex backend for them instead of 429ing upstream.
const LEGACY_CODEX_BASE_URLS = new Set(['https://api.openai.com/v1', 'https://api.openai.com/v1/']);

function resolveCodexBase(baseUrl: string | null): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/$/, '');
  return !trimmed || LEGACY_CODEX_BASE_URLS.has(trimmed) || LEGACY_CODEX_BASE_URLS.has(`${trimmed}/`) ? CODEX_BASE_URL : trimmed;
}

/**
Normalizes a Responses body for the Codex backend: `input` must be a list
of blocks (plain strings are wrapped as a single user message), `store`
must be false (the backend retains nothing for ChatGPT-backed calls), and
`stream` must be true (the backend only serves SSE). The gateway converts
back to JSON for non-streaming clients. Every other field passes through.
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
Codex (ChatGPT subscription) adapter.

Its `buildCall` takes an access token rather than a static secret, so it is
built through `buildCodexCall` instead of the generic `ProviderAdapter.buildCall`
path. The adapter still owns `parseUsage` and the base-URL normalization the
rest of the package shares.
*/
const codexAdapter: ProviderAdapter = {
  kind: 'OPENAI_CODEX',
  buildCall({ baseUrl, path, secret, body }) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
    };
    return {
      url: `${resolveCodexBase(baseUrl)}${path.startsWith('/') ? path : `/${path}`}`,
      headers,
      body: JSON.stringify(normalizeCodexBody(body)),
    };
  },
  parseUsage(json) {
    const usage = (json as { usage?: Record<string, unknown> } | null)?.usage;
    if (!usage || typeof usage !== 'object') return NO_USAGE;
    const prompt = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const completion = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    return prompt === 0 && completion === 0
      ? { promptTokens: 0, completionTokens: 0, estimated: true }
      : { promptTokens: prompt, completionTokens: completion, estimated: false };
  },
};

export { CODEX_BASE_URL, codexAdapter, normalizeCodexBody, resolveCodexBase };
