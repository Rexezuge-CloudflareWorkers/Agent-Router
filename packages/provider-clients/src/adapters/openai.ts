import type { ProviderAdapter } from './types';
import { NO_USAGE, joinUrl } from './types';

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';

function tokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
OpenAI Chat/Embeddings/Responses: Bearer auth. Usage arrives either as
Chat Completions' prompt/completion tokens or as the Responses API's
input/output tokens; both bodies pass through on the same adapter.
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
    const prompt = tokenCount(usage.input_tokens) ?? tokenCount(usage.prompt_tokens) ?? 0;
    const completion = tokenCount(usage.output_tokens) ?? tokenCount(usage.completion_tokens) ?? 0;
    if (prompt === 0 && completion === 0) {
      const total = tokenCount(usage.total_tokens) ?? 0;
      return { promptTokens: total, completionTokens: 0, estimated: total === 0 };
    }
    return { promptTokens: prompt, completionTokens: completion, estimated: false };
  },
};

export { openAiAdapter, DEFAULT_OPENAI_BASE };
