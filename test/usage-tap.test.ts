import { describe, expect, it } from 'vitest';
import { tapUsageStream } from '@agent-router/backend-services/router';

function upstream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

describe('tapUsageStream', () => {
  it('relays every byte untouched while reading Codex usage', async () => {
    const sse =
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hi"}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":2,"output_tokens":1}}}\n\n';
    const tap = tapUsageStream(upstream(sse));

    expect(await new Response(tap.stream).text()).toBe(sse);
    expect(await tap.usage).toEqual({ promptTokens: 2, completionTokens: 1, estimated: false });
  });

  it('merges Anthropic message_start and message_delta usage', async () => {
    const sse =
      'data: {"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":1}}}\n\n' +
      'data: {"type":"message_delta","usage":{"output_tokens":9}}\n\n';
    const tap = tapUsageStream(upstream(sse));

    expect(await new Response(tap.stream).text()).toBe(sse);
    expect(await tap.usage).toEqual({ promptTokens: 7, completionTokens: 9, estimated: false });
  });

  it('reads OpenAI chat usage frames', async () => {
    const sse = 'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":4}}\n\ndata: [DONE]\n\n';
    const tap = tapUsageStream(upstream(sse));

    await new Response(tap.stream).text();
    expect(await tap.usage).toEqual({ promptTokens: 3, completionTokens: 4, estimated: false });
  });

  it('settles as estimated when the stream carries no usage', async () => {
    const tap = tapUsageStream(upstream('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
    await new Response(tap.stream).text();
    expect(await tap.usage).toEqual({ promptTokens: 0, completionTokens: 0, estimated: true });
  });

  it('settles usage when the consumer cancels', async () => {
    const tap = tapUsageStream(upstream('data: {"type":"response.output_text.delta","delta":"hi"}\n\n'));
    const reader = tap.stream.getReader();
    await reader.read();
    await reader.cancel();

    expect(await tap.usage).toEqual({ promptTokens: 0, completionTokens: 0, estimated: true });
  });
});
