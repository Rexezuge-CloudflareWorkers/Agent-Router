import type { ProviderAdapter } from './types';
import { NO_USAGE, joinUrl } from './types';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

/**
OpenAI Chat/Embeddings: Bearer auth, prompt/completion token usage.
*/
const openAiAdapter: ProviderAdapter = {
  kind: 'OPENAI',
  buildCall({ baseUrl, path, secret, body, rawBody }) {
    return {
      url: joinUrl(baseUrl ?? DEFAULT_OPENAI_BASE, path),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
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

export { openAiAdapter, DEFAULT_OPENAI_BASE };
