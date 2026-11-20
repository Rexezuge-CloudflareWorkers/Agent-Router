import type { ProviderAdapter } from './types';
import { NO_USAGE, joinUrl } from './types';

const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

/**
Anthropic Messages: x-api-key + anthropic-version, input/output token usage.
*/
const anthropicAdapter: ProviderAdapter = {
  kind: 'ANTHROPIC',
  buildCall({ baseUrl, path, secret, body, anthropicVersion, rawBody }) {
    return {
      url: joinUrl(baseUrl ?? DEFAULT_ANTHROPIC_BASE, path),
      headers: {
        'content-type': 'application/json',
        'x-api-key': secret,
        'anthropic-version': anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION,
      },
      body: rawBody ?? JSON.stringify(body ?? {}),
    };
  },
  parseUsage(json) {
    const usage = (json as { usage?: Record<string, unknown> } | null)?.usage;
    if (!usage || typeof usage !== 'object') return NO_USAGE;
    return {
      promptTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
      completionTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
      estimated: false,
    };
  },
};

export { anthropicAdapter, DEFAULT_ANTHROPIC_BASE };
