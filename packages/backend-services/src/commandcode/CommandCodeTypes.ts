export type CommandCodeEndpoint = 'chat' | 'responses' | 'anthropic';

export interface CommandCodeUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface CommandCodeToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface CommandCodeEvent {
  type?: string;
  text?: string;
  delta?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  finishReason?: string;
  usage?: CommandCodeUsage;
  totalUsage?: CommandCodeUsage;
  error?: { message?: string; code?: string; statusCode?: number; isRetryable?: boolean };
  message?: string;
  code?: string;
}

export interface CommandCodeMappedError {
  status: number;
  type: string;
  message: string;
  code: string | null;
  reportedStatus: number | null;
  retryable: boolean;
}

export interface CommandCodeResult {
  bodyText: string;
  contentType: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

export interface CommandCodeStreamResult {
  bodyStream: ReadableStream<Uint8Array>;
  contentType: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  usagePromise: Promise<{ promptTokens: number; completionTokens: number; estimated: boolean }>;
}

export type CommandCodeCallResult =
  | { ok: true; result: CommandCodeResult | CommandCodeStreamResult }
  | { ok: false; status: number; message: string; retryable: boolean; code: string | null };

export interface CommandCodeModel {
  id: string;
  name: string;
  created?: number;
  ownedBy?: string;
}
