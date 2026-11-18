import { CommandCodeAccumulator } from './CommandCodeEvents';
import { sse } from './CommandCodeTranslator';
import type { CommandCodeTranslator } from './CommandCodeTranslator';
import type { CommandCodeEvent, CommandCodeMappedError } from './CommandCodeTypes';

class CommandCodeResponsesTranslator implements CommandCodeTranslator {
  public readonly accumulator = new CommandCodeAccumulator();
  public readonly contentType = 'text/event-stream';
  private started = false;
  private messageItemAdded = false;
  private reasoningItemAdded = false;
  private readonly toolIndexes: number[] = [];

  constructor(
    private readonly model: string,
    private readonly responseId: string,
    private readonly created: number,
  ) {}

  public feed(event: CommandCodeEvent): string[] {
    this.accumulator.add(event);
    const output: string[] = [];
    switch (event.type) {
      case 'text-delta': {
        const text = event.text ?? event.delta ?? '';
        if (!text) return output;
        this.ensureStart(output);
        if (!this.messageItemAdded) {
          this.messageItemAdded = true;
          output.push(
            sse('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: 0,
              item: { type: 'message', id: `msg_${this.responseId}`, status: 'in_progress', role: 'assistant', content: [] },
            }),
          );
        }
        output.push(
          sse('response.output_text.delta', {
            type: 'response.output_text.delta',
            item_id: `msg_${this.responseId}`,
            output_index: 0,
            content_index: 0,
            delta: text,
          }),
        );

        break;
      }
      case 'reasoning-delta': {
        const text = event.text ?? event.delta ?? '';
        if (!text) return output;
        this.ensureStart(output);
        if (!this.reasoningItemAdded) {
          this.reasoningItemAdded = true;
          output.push(
            sse('response.output_item.added', {
              type: 'response.output_item.added',
              output_index: this.messageItemAdded ? 1 : 0,
              item: { type: 'reasoning', id: `rs_${this.responseId}`, summary: [] },
            }),
          );
        }
        output.push(
          sse('response.reasoning_text.delta', {
            type: 'response.reasoning_text.delta',
            item_id: `rs_${this.responseId}`,
            output_index: this.messageItemAdded ? 1 : 0,
            content_index: 0,
            delta: text,
          }),
        );

        break;
      }
      case 'tool-call': {
        const call = this.accumulator.toolCalls.at(-1);
        if (!call) return output;
        const index = this.accumulator.toolCalls.length - 1;
        this.ensureStart(output);
        this.toolIndexes.push(index);
        output.push(
          sse('response.output_item.added', {
            type: 'response.output_item.added',
            output_index: this.baseOutputIndex() + index,
            item: { type: 'function_call', id: call.id, call_id: call.id, name: call.name, arguments: '' },
          }),
          sse('response.function_call_arguments.delta', {
            type: 'response.function_call_arguments.delta',
            item_id: call.id,
            output_index: this.baseOutputIndex() + index,
            delta: call.arguments,
          }),
        );

        break;
      }
      case 'error': {
        const error = this.accumulator.error;
        if (error) {
          output.push(
            sse('response.failed', {
              type: 'response.failed',
              response: {
                id: this.responseId,
                object: 'response',
                status: 'failed',
                error: { code: error.code ?? 'upstream_error', message: error.message },
              },
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
        sse('response.failed', {
          type: 'response.failed',
          response: {
            id: this.responseId,
            object: 'response',
            status: 'failed',
            error: {
              code: 'upstream_error',
              message: `Upstream stream ended without a completion finish (${incomplete}) — response was truncated`,
            },
          },
        }),
      ];
    }
    if (!this.accumulator.hasOutput()) {
      return [
        sse('response.failed', {
          type: 'response.failed',
          response: {
            id: this.responseId,
            object: 'response',
            status: 'failed',
            error: { code: 'rate_limit_error', message: 'Empty response from upstream (zero output tokens)' },
          },
        }),
      ];
    }
    const output: string[] = [];
    this.ensureStart(output);
    let outputIndex = 0;
    if (this.accumulator.reasoning) outputIndex += 1;
    if (this.accumulator.text) {
      output.push(
        sse('response.output_text.done', {
          type: 'response.output_text.done',
          item_id: `msg_${this.responseId}`,
          output_index: outputIndex,
          content_index: 0,
          text: this.accumulator.text,
        }),
        sse('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: {
            type: 'message',
            id: `msg_${this.responseId}`,
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: this.accumulator.text, annotations: [] }],
          },
        }),
      );
      outputIndex += 1;
    }
    for (const call of this.accumulator.toolCalls) {
      output.push(
        sse('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: { type: 'function_call', id: call.id, call_id: call.id, name: call.name, arguments: call.arguments },
        }),
      );
      outputIndex += 1;
    }
    output.push(
      sse('response.completed', {
        type: 'response.completed',
        response: this.finalJson(),
      }),
    );
    return output;
  }

  public finalJson(): Record<string, unknown> {
    const accumulator = this.accumulator;
    const output: Array<Record<string, unknown>> = [];
    if (accumulator.reasoning) {
      output.push({ type: 'reasoning', id: `rs_${this.responseId}`, summary: [{ type: 'summary_text', text: accumulator.reasoning }] });
    }
    if (accumulator.text) {
      output.push({
        type: 'message',
        id: `msg_${this.responseId}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: accumulator.text, annotations: [] }],
      });
    }
    for (const call of accumulator.toolCalls) {
      output.push({ type: 'function_call', id: call.id, call_id: call.id, name: call.name, arguments: call.arguments });
    }
    return {
      id: this.responseId,
      object: 'response',
      created_at: this.created,
      status: 'completed',
      model: this.model,
      output,
      output_text: accumulator.text,
      usage: {
        input_tokens: accumulator.usage.inputTokens ?? 0,
        output_tokens: accumulator.usage.outputTokens ?? 0,
        total_tokens: (accumulator.usage.inputTokens ?? 0) + (accumulator.usage.outputTokens ?? 0),
        input_tokens_details: { cached_tokens: accumulator.usage.cachedInputTokens ?? 0 },
      },
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

  private baseOutputIndex(): number {
    return (this.reasoningItemAdded ? 1 : 0) + (this.messageItemAdded ? 1 : 0);
  }

  private ensureStart(output: string[]): void {
    if (this.started) return;
    this.started = true;
    output.push(
      sse('response.created', {
        type: 'response.created',
        response: {
          id: this.responseId,
          object: 'response',
          created_at: this.created,
          status: 'in_progress',
          model: this.model,
          output: [],
        },
      }),
      sse('response.in_progress', { type: 'response.in_progress', response: { id: this.responseId } }),
    );
  }
}

export { CommandCodeResponsesTranslator };
