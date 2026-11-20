import type { ProviderAdapter } from './types';
import { NO_USAGE, joinUrl } from './types';

const DEFAULT_GEMINI_BASE = 'https://generativelanguage.googleapis.com';

/**
Gemini: the API key rides in the query string (`?key=`) rather than a header,
and usage uses prompt/completion-style counters with a total fallback.
*/
const geminiAdapter: ProviderAdapter = {
  kind: 'GEMINI',
  buildCall({ baseUrl, path, secret, body, rawBody }) {
    const base = baseUrl ?? DEFAULT_GEMINI_BASE;
    const joined = joinUrl(base, path);
    const separator = joined.includes('?') ? '&' : '?';
    return {
      url: `${joined}${separator}key=${encodeURIComponent(secret)}`,
      headers: { 'content-type': 'application/json' },
      body: rawBody ?? JSON.stringify(body ?? {}),
    };
  },
  parseUsage(json) {
    const usage = (json as { usage?: Record<string, unknown> } | null)?.usage;
    if (!usage || typeof usage !== 'object') return NO_USAGE;
    const prompt = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
    const completion = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0;
    if (prompt === 0 && completion === 0) {
      const total = typeof usage.total_tokens === 'number' ? usage.total_tokens : 0;
      return { promptTokens: total, completionTokens: 0, estimated: total === 0 };
    }
    return { promptTokens: prompt, completionTokens: completion, estimated: false };
  },
};

export { geminiAdapter, DEFAULT_GEMINI_BASE };
