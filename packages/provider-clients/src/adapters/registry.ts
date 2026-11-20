import type { ProviderKind } from '@agent-router/shared';
import type { ProviderAdapter } from './types';
import { anthropicAdapter } from './anthropic';
import { codexAdapter } from './codex';
import { geminiAdapter } from './gemini';
import { openAiAdapter } from './openai';

/**
Adapter lookup keyed by provider kind.

`OPENAI_COMPAT` reuses the OpenAI shape (it is OpenAI-wire-compatible with a
custom base URL). `COMMAND_CODE` is intentionally absent: its traffic is
handled by `CommandCodeService` (a different envelope and event protocol),
so a call here is a programming error rather than a fallback.
*/
const ADAPTERS: Partial<Record<ProviderKind, ProviderAdapter>> = {
  OPENAI: openAiAdapter,
  OPENAI_COMPAT: openAiAdapter,
  ANTHROPIC: anthropicAdapter,
  GEMINI: geminiAdapter,
  OPENAI_CODEX: codexAdapter,
};

function getAdapter(kind: ProviderKind): ProviderAdapter | null {
  return ADAPTERS[kind] ?? null;
}

export { getAdapter };
