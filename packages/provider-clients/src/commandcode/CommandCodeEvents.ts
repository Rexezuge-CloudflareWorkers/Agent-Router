import type { CommandCodeEvent, CommandCodeMappedError, CommandCodeUsage } from './CommandCodeTypes';

const CC_STATUS_MAP: Record<number, { status: number; type: string }> = {
  400: { status: 400, type: 'invalid_request_error' },
  401: { status: 401, type: 'authentication_error' },
  402: { status: 429, type: 'rate_limit_error' },
  403: { status: 401, type: 'authentication_error' },
  404: { status: 404, type: 'not_found' },
  422: { status: 400, type: 'invalid_request_error' },
  429: { status: 429, type: 'rate_limit_error' },
  500: { status: 502, type: 'upstream_error' },
  502: { status: 502, type: 'upstream_error' },
  503: { status: 503, type: 'temporarily_unavailable' },
};

const RETRYABLE = new Set([429, 502, 503]);

function mapFinishReason(reason: unknown): string {
  const value = (typeof reason === 'string' ? reason : '').trim().toLowerCase();
  if (!value) return 'stop';
  if (['tool-calls', 'tool_calls', 'tool_use'].includes(value)) return 'tool_calls';
  if (['length', 'max_tokens', 'max_output_tokens', 'model_context_window_exceeded'].includes(value)) {
    return 'length';
  }
  return value === 'error' || /^(?:network|connection|upstream)[-_\s]?error$/.test(value) ? 'upstream_error' : value;
}

function toOpenAiFinishReason(reason: string): string {
  return ['tool_calls', 'length', 'stop'].includes(reason) ? reason : 'stop';
}

function normalizeUsage(usage: CommandCodeUsage | null | undefined): CommandCodeUsage {
  if (!usage) return {};
  const normalized: CommandCodeUsage = { ...usage };
  if (!Number(normalized.outputTokens)) {
    normalized.inputTokens = 0;
    normalized.cachedInputTokens = 0;
  }
  return normalized;
}

function anthropicInputTokens(usage: CommandCodeUsage | null | undefined): number {
  const value = usage ?? {};
  const noCache = value.inputTokenDetails?.noCacheTokens;
  if (typeof noCache === 'number' && noCache >= 0) return noCache;
  const cacheRead = value.cachedInputTokens ?? value.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = value.inputTokenDetails?.cacheWriteTokens ?? 0;
  return Math.max(0, (value.inputTokens ?? 0) - cacheRead - cacheWrite);
}

function mappedStatus(ccStatus: number): { status: number; type: string } {
  return CC_STATUS_MAP[ccStatus] ?? { status: 502, type: 'upstream_error' };
}

function mapCcError(ccStatus: number, bodyText: string): CommandCodeMappedError {
  const mapped = mappedStatus(ccStatus);
  let message = `Command Code API error (${ccStatus})`;
  let code: string | null = null;
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: string; code?: string }; message?: string; code?: string };
    message = parsed.error?.message ?? parsed.message ?? message;
    code = parsed.error?.code ?? parsed.code ?? null;
  } catch {
    message = bodyText.slice(0, 200) || message;
  }
  return {
    status: mapped.status,
    type: mapped.type,
    message,
    code,
    reportedStatus: ccStatus,
    retryable: RETRYABLE.has(mapped.status),
  };
}

function mapCcEventError(event: CommandCodeEvent): CommandCodeMappedError {
  const message = event.error?.message ?? event.message ?? 'Unknown Command Code error';
  const code = event.error?.code ?? event.code ?? null;
  const statusMatch = /^<(\d{3})>/.exec(message);
  const reportedStatus = statusMatch
    ? Number(statusMatch[1])
    : Number.isSafeInteger(event.error?.statusCode)
      ? (event.error?.statusCode as number)
      : null;
  const mapped = mappedStatus(reportedStatus ?? 502);
  return {
    status: mapped.status,
    type: mapped.type,
    message,
    code,
    reportedStatus,
    retryable: RETRYABLE.has(mapped.status),
  };
}

function incompleteDetail(sawFinish: boolean, finishReason: string): string | null {
  if (!sawFinish) return 'no finish event';
  return finishReason === 'upstream_error' ? 'provider reported an upstream connection failure' : null;
}

function parseLine(line: string): CommandCodeEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === '[DONE]' || trimmed.startsWith(':')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const event = parsed as CommandCodeEvent;
    return event.type ? event : null;
  } catch {
    return null;
  }
}

class CommandCodeAccumulator {
  public text = '';
  public reasoning = '';
  public toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
  public usage: CommandCodeUsage = {};
  public finishReason = 'stop';
  public sawFinish = false;
  public error: CommandCodeMappedError | null = null;
  public lastEvent = '';

  public add(event: CommandCodeEvent): void {
    this.lastEvent = event.type ?? this.lastEvent;
    switch (event.type) {
      case 'text-delta': {
        this.text += event.text ?? event.delta ?? '';
        break;
      }
      case 'reasoning-delta': {
        this.reasoning += event.text ?? event.delta ?? '';
        break;
      }
      case 'tool-call': {
        const input = event.input ?? {};
        this.toolCalls.push({
          id: event.toolCallId ?? `call_${this.toolCalls.length}`,
          name: event.toolName ?? '',
          arguments: typeof input === 'string' ? input : JSON.stringify(input),
        });
        break;
      }
      case 'finish-step': {
        this.sawFinish = true;
        this.finishReason = mapFinishReason(event.finishReason ?? this.finishReason);
        if (event.usage) this.usage = event.usage;
        break;
      }
      case 'finish': {
        this.sawFinish = true;
        this.finishReason = mapFinishReason(event.finishReason ?? this.finishReason);
        this.usage = normalizeUsage(event.totalUsage ?? event.usage ?? this.usage);
        break;
      }
      case 'error': {
        this.error = mapCcEventError(event);
        break;
      }
      default: {
        break;
      }
    }
  }

  public incomplete(): string | null {
    return incompleteDetail(this.sawFinish, this.finishReason);
  }

  public hasOutput(): boolean {
    return this.text.length > 0 || this.reasoning.length > 0 || this.toolCalls.length > 0;
  }
}

export {
  CC_STATUS_MAP,
  CommandCodeAccumulator,
  anthropicInputTokens,
  incompleteDetail,
  mapCcError,
  mapCcEventError,
  mapFinishReason,
  normalizeUsage,
  parseLine,
  toOpenAiFinishReason,
};
