import type { CommandCodeAccumulator } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import type { CommandCodeEvent, CommandCodeMappedError } from '@agent-router/provider-clients/commandcode/CommandCodeTypes';

interface CommandCodeTranslator {
  readonly accumulator: CommandCodeAccumulator;
  readonly contentType: string;
  feed(event: CommandCodeEvent): string[];
  finalize(): string[];
  finalJson(): Record<string, unknown>;
  /** Set when `finalize` should not be written to the client because the upstream
  stream failed before any output. */
  failure(): CommandCodeMappedError | { status: number; type: string; message: string } | null;
}

function sse(event: string | null, data: unknown): string {
  return `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

function openAiChunk(
  id: string,
  created: number,
  model: string,
  delta: Record<string, unknown>,
  finishReason: string | null,
  usage?: Record<string, unknown>,
): string {
  const chunk: Record<string, unknown> = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  if (usage) chunk.usage = usage;
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function usageRecord(accumulator: CommandCodeAccumulator): Record<string, unknown> {
  return {
    prompt_tokens: accumulator.usage.inputTokens ?? 0,
    completion_tokens: accumulator.usage.outputTokens ?? 0,
    total_tokens: (accumulator.usage.inputTokens ?? 0) + (accumulator.usage.outputTokens ?? 0),
    prompt_tokens_details: { cached_tokens: accumulator.usage.cachedInputTokens ?? 0 },
  };
}

export { openAiChunk, sse, usageRecord };
export type { CommandCodeTranslator };
