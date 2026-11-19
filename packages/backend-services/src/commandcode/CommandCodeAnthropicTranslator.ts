import { CommandCodeAccumulator, anthropicInputTokens } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import { sse } from './CommandCodeTranslator';
import type { CommandCodeTranslator } from './CommandCodeTranslator';
import type { CommandCodeEvent, CommandCodeMappedError } from '@agent-router/provider-clients/commandcode/CommandCodeTypes';

function mapStopReason(reason: string): string {
  if (reason === 'tool_calls') return 'tool_use';
  return reason === 'length' ? 'max_tokens' : 'end_turn';
}

class CommandCodeAnthropicTranslator implements CommandCodeTranslator {
  public readonly accumulator = new CommandCodeAccumulator();
  public readonly contentType = 'text/event-stream';
  private started = false;
  private blockIndex = -1;
  private blockType: 'text' | 'thinking' | 'tool_use' | null = null;

  constructor(
    private readonly model: string,
    private readonly messageId: string,
  ) {}

  public feed(event: CommandCodeEvent): string[] {
    this.accumulator.add(event);
    const output: string[] = [];
    switch (event.type) {
      case 'text-delta': {
        const text = event.text ?? event.delta ?? '';
        if (!text) return output;
        this.ensureStart(output);
        if (this.blockType !== 'text') this.openBlock(output, 'text', { type: 'text', text: '' });
        output.push(
          sse('content_block_delta', { type: 'content_block_delta', index: this.blockIndex, delta: { type: 'text_delta', text } }),
        );

        break;
      }
      case 'reasoning-delta': {
        const text = event.text ?? event.delta ?? '';
        if (!text) return output;
        this.ensureStart(output);
        if (this.blockType !== 'thinking') this.openBlock(output, 'thinking', { type: 'thinking', thinking: '' });
        output.push(
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: this.blockIndex,
            delta: { type: 'thinking_delta', thinking: text },
          }),
        );

        break;
      }
      case 'tool-call': {
        const call = this.accumulator.toolCalls.at(-1);
        if (!call) return output;
        this.ensureStart(output);
        this.openBlock(output, 'tool_use', { type: 'tool_use', id: call.id, name: call.name, input: {} });
        output.push(
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: this.blockIndex,
            delta: { type: 'input_json_delta', partial_json: call.arguments },
          }),
        );

        break;
      }
      case 'error': {
        const error = this.accumulator.error;
        if (error) {
          output.push(
            sse('error', {
              type: 'error',
              error: { type: error.type, message: error.message },
              ...(error.status === 429 && { retry_after: 30 }),
            }),
          );
        }

        break;
      }
      // No default
    }
    return output;
  }

  public finalize(): string[] {
    if (this.accumulator.error) return [];
    const incomplete = this.accumulator.incomplete();
    if (incomplete) {
      return [
        sse('error', {
          type: 'error',
          error: {
            type: 'upstream_error',
            message: `Upstream stream ended without a completion finish (${incomplete}) — response was truncated`,
          },
          retry_after: 10,
        }),
      ];
    }
    if (!this.accumulator.hasOutput()) {
      return [
        sse('error', {
          type: 'error',
          error: { type: 'rate_limit_error', message: 'Empty response from upstream (zero output tokens)' },
          retry_after: 10,
        }),
      ];
    }
    const output: string[] = [];
    this.ensureStart(output);
    if (this.blockType) {
      output.push(sse('content_block_stop', { type: 'content_block_stop', index: this.blockIndex }));
      this.blockType = null;
    }
    output.push(
      sse('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: mapStopReason(this.accumulator.finishReason) },
        usage: this.usage(),
      }),
      sse('message_stop', { type: 'message_stop' }),
    );
    return output;
  }

  public finalJson(): Record<string, unknown> {
    const accumulator = this.accumulator;
    const content: Array<Record<string, unknown>> = [];
    if (accumulator.reasoning) content.push({ type: 'thinking', thinking: accumulator.reasoning, signature: '' });
    if (accumulator.text) content.push({ type: 'text', text: accumulator.text });
    for (const call of accumulator.toolCalls) {
      let input: unknown = {};
      try {
        input = JSON.parse(call.arguments);
      } catch {
        input = {};
      }
      content.push({ type: 'tool_use', id: call.id, name: call.name, input });
    }
    if (content.length === 0) content.push({ type: 'text', text: '' });
    return {
      id: this.messageId,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content,
      stop_reason: mapStopReason(accumulator.finishReason),
      stop_sequence: null,
      usage: this.usage(),
    };
  }

  public failure(): CommandCodeMappedError | { status: number; type: string; message: string } | null {
    if (this.accumulator.error) return this.accumulator.error;
    const incomplete = this.accumulator.incomplete();
    if (incomplete) {
      return {
        status: 502,
        type: 'upstream_error',
        message: `Upstream stream ended without a completion finish (${incomplete}) — response was truncated`,
      };
    }
    return this.accumulator.hasOutput()
      ? null
      : { status: 429, type: 'rate_limit_error', message: 'Empty response from upstream (zero output tokens)' };
  }

  private usage(): Record<string, number> {
    return {
      input_tokens: anthropicInputTokens(this.accumulator.usage),
      output_tokens: this.accumulator.usage.outputTokens ?? 0,
      cache_read_input_tokens: this.accumulator.usage.cachedInputTokens ?? 0,
      cache_creation_input_tokens: this.accumulator.usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    };
  }

  private ensureStart(output: string[]): void {
    if (this.started) return;
    this.started = true;
    output.push(
      sse('message_start', {
        type: 'message_start',
        message: {
          id: this.messageId,
          type: 'message',
          role: 'assistant',
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }),
      sse('ping', { type: 'ping' }),
    );
  }

  private openBlock(output: string[], type: 'text' | 'thinking' | 'tool_use', block: Record<string, unknown>): void {
    if (this.blockType) output.push(sse('content_block_stop', { type: 'content_block_stop', index: this.blockIndex }));
    this.blockIndex += 1;
    this.blockType = type;
    output.push(sse('content_block_start', { type: 'content_block_start', index: this.blockIndex, content_block: block }));
  }
}

export { CommandCodeAnthropicTranslator };
