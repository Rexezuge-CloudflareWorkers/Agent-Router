import { CommandCodeAccumulator, toOpenAiFinishReason } from '@agent-router/provider-clients/commandcode/CommandCodeEvents';
import { openAiChunk, usageRecord } from './CommandCodeTranslator';
import type { CommandCodeTranslator } from './CommandCodeTranslator';
import type { CommandCodeEvent, CommandCodeMappedError } from '@agent-router/provider-clients/commandcode/CommandCodeTypes';

class CommandCodeChatTranslator implements CommandCodeTranslator {
  public readonly accumulator = new CommandCodeAccumulator();
  public readonly contentType = 'text/event-stream';
  private chunkIndex = 0;
  private finishEmitted = false;

  constructor(
    private readonly id: string,
    private readonly created: number,
    private readonly model: string,
  ) {}

  public feed(event: CommandCodeEvent): string[] {
    this.accumulator.add(event);
    const output: string[] = [];
    switch (event.type) {
      case 'text-delta': {
        const text = event.text ?? event.delta ?? '';
        if (text) {
          output.push(openAiChunk(this.id, this.created, this.model, this.chunkDelta({ content: text }), null));
        }

        break;
      }
      case 'reasoning-delta': {
        const text = event.text ?? event.delta ?? '';
        if (text) output.push(openAiChunk(this.id, this.created, this.model, this.chunkDelta({ reasoning_content: text }), null));

        break;
      }
      case 'tool-call': {
        const call = this.accumulator.toolCalls.at(-1);
        if (!call) return output;
        output.push(
          openAiChunk(
            this.id,
            this.created,
            this.model,
            this.chunkDelta({
              tool_calls: [
                {
                  index: this.accumulator.toolCalls.length - 1,
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments },
                },
              ],
            }),
            null,
          ),
        );

        break;
      }
      case 'finish': {
        this.finishEmitted = true;
        output.push(
          openAiChunk(
            this.id,
            this.created,
            this.model,
            {},
            toOpenAiFinishReason(this.accumulator.finishReason),
            usageRecord(this.accumulator),
          ),
        );

        break;
      }
      // No default
    }
    return output;
  }

  public finalize(): string[] {
    if (this.accumulator.error)
      return [`data: ${JSON.stringify({ error: this.accumulator.error.message, type: this.accumulator.error.type })}\n\n`];
    const incomplete = this.accumulator.incomplete();
    if (incomplete) {
      return [
        `data: ${JSON.stringify({
          error: {
            message: `Upstream stream ended without a completion finish (${incomplete}) — response was truncated`,
            type: 'upstream_error',
          },
          retry_after: 10,
        })}\n\n`,
      ];
    }
    if (!this.accumulator.hasOutput()) {
      return [
        `data: ${JSON.stringify({ error: { message: 'Empty response from upstream (zero output tokens)', type: 'rate_limit_error' }, retry_after: 10 })}\n\n`,
      ];
    }
    const events: string[] = [];
    if (!this.finishEmitted) {
      events.push(
        openAiChunk(
          this.id,
          this.created,
          this.model,
          {},
          toOpenAiFinishReason(this.accumulator.finishReason),
          usageRecord(this.accumulator),
        ),
      );
    }
    events.push('data: [DONE]\n\n');
    return events;
  }

  public finalJson(): Record<string, unknown> {
    const accumulator = this.accumulator;
    const message: Record<string, unknown> = { role: 'assistant', content: accumulator.text || null };
    if (accumulator.toolCalls.length > 0) {
      message.tool_calls = accumulator.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      }));
    }
    if (accumulator.reasoning) message.reasoning_content = accumulator.reasoning;
    return {
      id: this.id,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices: [{ index: 0, message, finish_reason: toOpenAiFinishReason(accumulator.finishReason) }],
      usage: usageRecord(accumulator),
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

  private chunkDelta(delta: Record<string, unknown>): Record<string, unknown> {
    if (this.chunkIndex === 0) {
      this.chunkIndex += 1;
      return { role: 'assistant', ...delta };
    }
    this.chunkIndex += 1;
    return delta;
  }
}

export { CommandCodeChatTranslator };
