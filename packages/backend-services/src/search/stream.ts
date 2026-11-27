import { asArray, asRecord, asString } from '@agent-router/provider-clients/shared/coercion';
import { anthropicCitations, citationsFor, injectCitations, openAiAnnotations } from './responseShapes';
import { WEB_SEARCH_TOOL_NAME } from './types';
import type { SearchEndpoint, SearchResult } from './types';

type JsonBody = Record<string, unknown>;

interface ParsedFrame {
  event: string | null;
  dataText: string;
  payload: unknown;
}

interface SearchStreamAdapter {
  /**
  Consumes one SSE frame and returns the frames safe to emit right now.
  */
  observe(frame: string): string[];
  /**
  Buffered-style payload reconstructed from the frames seen so far.
  */
  payload(): unknown;
  /**
  Terminal frames with citations injected, emitted after the last round.
  */
  finish(results: SearchResult[]): string[];
  /**
  Reset per-round state while keeping ids/indices stable across rounds.
  */
  nextRound(): void;
}

function sse(event: string | null, data: unknown): string {
  return `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

function doneFrame(): string {
  return 'data: [DONE]\n\n';
}

function parseFrame(frame: string): ParsedFrame | null {
  let event: string | null = null;
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return null;
  const dataText = dataLines.join('\n').trim();
  if (dataText === '[DONE]') return { event, dataText, payload: null };
  try {
    return { event, dataText, payload: JSON.parse(dataText) as unknown };
  } catch {
    return { event, dataText, payload: null };
  }
}

function splitFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  for (;;) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (!match) break;
    frames.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
  }
  return { frames, rest };
}

function eventName(parsed: ParsedFrame, type: string): string | null {
  return parsed.event ?? (type ? type : null);
}

/**
Chat completion chunks are stateless enough to relay with a one-chunk hold on the terminal frame.
*/
class ChatStreamAdapter implements SearchStreamAdapter {
  private id: string | null = null;
  private model = 'web-search';
  private created = Math.floor(Date.now() / 1000);
  private text = '';
  private calls = new Map<number, { id: string; name: string; arguments: string }>();
  private internal = new Set<number>();
  private usage: unknown;
  private held: string[] = [];
  private holding = false;
  private continuation = false;

  public observe(frame: string): string[] {
    const parsed = parseFrame(frame);
    if (!parsed) return [frame];
    if (parsed.dataText === '[DONE]') {
      this.holding = true;
      this.held.push(doneFrame());
      return [];
    }
    const chunk = asRecord(parsed.payload);
    if (!this.id) {
      this.id = asString(chunk.id) || null;
      this.model = asString(chunk.model) || this.model;
      this.created = typeof chunk.created === 'number' ? chunk.created : this.created;
    }
    if (chunk.usage !== undefined) this.usage = chunk.usage;
    const choice = asRecord(asArray(chunk.choices).map(asRecord)[0]);
    const delta = asRecord(choice.delta);
    const content = asString(delta.content);
    if (content) this.text += content;

    const kept: unknown[] = [];
    const toolCalls = asArray(delta.tool_calls).map(asRecord);
    for (const call of toolCalls) {
      const index = typeof call.index === 'number' ? call.index : kept.length;
      const fn = asRecord(call.function);
      const name = asString(fn.name);
      const args = asString(fn.arguments);
      const stored = this.calls.get(index) ?? { id: '', name: '', arguments: '' };
      stored.id = asString(call.id) || stored.id;
      if (name) stored.name = name;
      stored.arguments += args;
      this.calls.set(index, stored);
      if (stored.name === WEB_SEARCH_TOOL_NAME) {
        this.internal.add(index);
        continue;
      }
      const outgoing: JsonBody = { ...call, index };
      if (stored.id) outgoing.id = stored.id;
      outgoing.function = {
        ...fn,
        ...(name && { name }),
        ...(args && { arguments: args }),
      };
      kept.push(outgoing);
    }

    const outgoingDelta: JsonBody = { ...delta };
    if (kept.length > 0) outgoingDelta.tool_calls = kept;
    else delete outgoingDelta.tool_calls;
    const hasContent = Object.keys(outgoingDelta).some((key) => key !== 'role' && outgoingDelta[key] !== undefined);
    const finishReason = choice.finish_reason;
    if (finishReason !== undefined && finishReason !== null) {
      this.holding = true;
      this.held.push(sse(parsed.event, { ...chunk, id: this.id ?? chunk.id, choices: [{ ...choice, delta: outgoingDelta }] }));
      return [];
    }
    if (!hasContent) return [];
    // The follow-up call starts with a fresh role-only chunk; the client is
    // already inside an assistant message, so it must not be repeated.
    if (this.continuation && !content && Object.keys(outgoingDelta).length === 1 && typeof outgoingDelta.role === 'string') return [];
    return [sse(parsed.event, { ...chunk, id: this.id ?? chunk.id, choices: [{ ...choice, delta: outgoingDelta }] })];
  }

  public payload(): unknown {
    const toolCalls = [...this.calls.values()]
      .filter((call) => call.name)
      .map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }));
    return {
      id: this.id ?? `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: this.created,
      model: this.model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: this.text, ...(toolCalls.length > 0 && { tool_calls: toolCalls }) },
        },
      ],
      ...(this.usage !== undefined && { usage: this.usage }),
    };
  }

  public finish(results: SearchResult[]): string[] {
    const annotations = openAiAnnotations(citationsFor(results, this.text));
    const frames = this.held.map((frame) => {
      const parsed = parseFrame(frame);
      if (!parsed || parsed.payload === null || parsed.dataText === '[DONE]') return frame;
      const chunk = asRecord(parsed.payload);
      const choice = asRecord(asArray(chunk.choices).map(asRecord)[0]);
      return sse(parsed.event, {
        ...chunk,
        id: this.id ?? chunk.id,
        choices: [{ ...choice, delta: { ...asRecord(choice.delta), annotations } }],
      });
    });
    if (frames.every((frame) => parseFrame(frame)?.dataText === '[DONE]')) {
      frames.unshift(
        sse(null, {
          id: this.id ?? `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: this.created,
          model: this.model,
          choices: [{ index: 0, delta: { annotations }, finish_reason: 'stop' }],
        }),
      );
    }
    if (frames.every((frame) => parseFrame(frame)?.dataText !== '[DONE]')) frames.push(doneFrame());
    return frames;
  }

  public nextRound(): void {
    this.continuation = true;
    this.text = '';
    this.calls = new Map();
    this.internal = new Set();
    this.held = [];
    this.holding = false;
  }
}

/**
Responses API events carry complete items; keep their ids stable across tool rounds.
*/
class ResponsesStreamAdapter implements SearchStreamAdapter {
  private responseId: string | null = null;
  private offset = 0;
  private emitted = 0;
  private ids = new Map<string, string>();
  private internalIds = new Set<string>();
  private completed: JsonBody | null = null;

  public observe(frame: string): string[] {
    const parsed = parseFrame(frame);
    if (!parsed) return [frame];
    const payload = asRecord(parsed.payload);
    const type = asString(payload.type);
    if (type === 'response.created') {
      if (!this.responseId) {
        this.responseId = asString(asRecord(payload.response).id) || null;
        return [frame];
      }
      return [];
    }
    if (type === 'response.output_item.added') {
      const item = asRecord(payload.item);
      const original = asString(item.id);
      if (asString(item.type) === 'function_call' && asString(item.name) === WEB_SEARCH_TOOL_NAME) {
        if (original) this.internalIds.add(original);
        return [];
      }
      const replacement = `${this.responseId ?? 'resp'}_item_${this.offset + this.emitted}`;
      if (original) this.ids.set(original, replacement);
      const index = this.offset + this.emitted;
      this.emitted += 1;
      return [sse(eventName(parsed, type), { ...payload, output_index: index, item: { ...item, id: replacement } })];
    }
    if (type === 'response.completed') {
      this.completed = asRecord(payload.response);
      return [];
    }
    if (this.internalIds.has(asString(payload.item_id))) return [];
    return [sse(eventName(parsed, type), this.rewrite(payload))];
  }

  public payload(): unknown {
    return this.completed;
  }

  public finish(results: SearchResult[]): string[] {
    if (!this.completed) return [];
    const cited = asRecord(injectCitations(this.completed, results, 'responses'));
    const output = asArray(cited.output)
      .map(asRecord)
      .filter((item) => !this.internalIds.has(asString(item.id)))
      .map((item) => {
        const original = asString(item.id);
        const replacement = original ? (this.ids.get(original) ?? original) : original;
        return replacement ? { ...item, id: replacement } : item;
      });
    const frames: string[] = [];
    for (const item of output) {
      if (asString(item.type) !== 'message') continue;
      const itemId = asString(item.id) ?? `msg_${this.responseId ?? 'web_search'}`;
      const contentBlocks = asArray(item.content).map(asRecord);
      for (const block of contentBlocks) {
        if (asString(block.type) !== 'output_text') continue;
        for (const [index, annotation] of asArray(block.annotations).entries()) {
          frames.push(
            sse('response.output_text.annotation.added', {
              type: 'response.output_text.annotation.added',
              item_id: itemId,
              output_index: this.offset + output.indexOf(item),
              content_index: contentBlocks.indexOf(block),
              annotation_index: index,
              annotation,
            }),
          );
        }
      }
    }
    frames.push(
      sse('response.completed', {
        type: 'response.completed',
        response: {
          ...cited,
          id: this.responseId ?? asString(cited.id),
          output,
        },
      }),
    );
    return frames;
  }

  public nextRound(): void {
    this.offset += this.emitted;
    this.emitted = 0;
    this.ids = new Map();
    this.internalIds = new Set();
    this.completed = null;
  }

  private rewrite(payload: JsonBody): JsonBody {
    const itemId = asString(payload.item_id);
    const replacement = itemId ? this.ids.get(itemId) : null;
    const out: JsonBody = { ...payload };
    if (replacement) out.item_id = replacement;
    if (typeof payload.output_index === 'number') out.output_index = this.offset + payload.output_index;
    if (typeof payload.content_index === 'number') out.content_index = payload.content_index;
    if (asRecord(payload.item).id) {
      out.item = { ...asRecord(payload.item), id: this.ids.get(asString(asRecord(payload.item).id)) ?? asRecord(payload.item).id };
    }
    return out;
  }
}

/**
Anthropic tool_use blocks are indexed, so internal blocks can be filtered by index.
*/
class AnthropicStreamAdapter implements SearchStreamAdapter {
  private messageId: string | null = null;
  private model = 'web-search';
  private usage: unknown;
  private blocks = new Map<number, { type: string; name: string; id: string; input: string; text: string }>();
  private internal = new Set<number>();
  private textIndex: number | null = null;
  private held: Array<{ frame: string; type: string; index: number | null }> = [];
  private continuation = false;

  public observe(frame: string): string[] {
    const parsed = parseFrame(frame);
    if (!parsed) return [frame];
    const payload = asRecord(parsed.payload);
    const type = asString(payload.type) || parsed.event || '';
    if (type === 'message_start') {
      const message = asRecord(payload.message);
      this.messageId = asString(message.id) || this.messageId;
      this.model = asString(message.model) || this.model;
      this.usage = message.usage;
      return this.continuation ? [] : [frame];
    }
    if (type === 'content_block_start') {
      const index = typeof payload.index === 'number' ? payload.index : 0;
      const block = asRecord(payload.content_block);
      const name = asString(block.name);
      this.blocks.set(index, { type: asString(block.type), name, id: asString(block.id), input: '', text: '' });
      if (asString(block.type) === 'tool_use' && name === WEB_SEARCH_TOOL_NAME) {
        this.internal.add(index);
        return [];
      }
      if (asString(block.type) === 'text') this.textIndex = index;
      return [frame];
    }
    if (type === 'content_block_delta') {
      const index = typeof payload.index === 'number' ? payload.index : 0;
      const delta = asRecord(payload.delta);
      const block = this.blocks.get(index);
      if (asString(delta.type) === 'text_delta' && block) block.text += asString(delta.text);
      if (asString(delta.type) === 'input_json_delta' && block) block.input += asString(delta.partial_json);
      if (this.internal.has(index)) return [];
      return [frame];
    }
    if (type === 'content_block_stop') {
      const index = typeof payload.index === 'number' ? payload.index : 0;
      if (this.internal.has(index)) return [];
      this.held.push({ frame, type, index });
      return [];
    }
    if (type === 'message_delta' || type === 'message_stop') {
      this.held.push({ frame, type, index: null });
      return [];
    }
    return [frame];
  }

  public payload(): unknown {
    const content = [...this.blocks.values()].map((block) => {
      if (block.type === 'tool_use') {
        let input: unknown = {};
        try {
          input = JSON.parse(block.input || '{}') as unknown;
        } catch {
          input = {};
        }
        return { type: 'tool_use', id: block.id, name: block.name, input };
      }
      return { type: 'text', text: block.text };
    });
    return {
      id: this.messageId ?? `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model: this.model,
      content,
      ...(this.usage !== undefined && { usage: this.usage }),
    };
  }

  public finish(results: SearchResult[]): string[] {
    const text = this.textIndex === null ? '' : (this.blocks.get(this.textIndex)?.text ?? '');
    const frames: string[] = [];
    for (const entry of this.held) {
      if (entry.type === 'content_block_stop' && entry.index === this.textIndex && results.length > 0) {
        frames.push(
          sse('content_block_delta', {
            type: 'content_block_delta',
            index: entry.index,
            delta: { type: 'citations_delta', citations: anthropicCitations(citationsFor(results, text)) },
          }),
        );
      }
      frames.push(entry.frame);
    }
    if (this.held.every((entry) => entry.type !== 'message_stop')) frames.push(sse('message_stop', { type: 'message_stop' }));
    return frames;
  }

  public nextRound(): void {
    this.continuation = true;
    this.blocks = new Map();
    this.internal = new Set();
    this.textIndex = null;
    this.held = [];
  }
}

/**
Gemini streamGenerateContent frames are JSON SSE chunks; keep one frame in hand to patch metadata.
*/
class GeminiStreamAdapter implements SearchStreamAdapter {
  private parts: unknown[] = [];
  private held: JsonBody | null = null;

  public observe(frame: string): string[] {
    const parsed = parseFrame(frame);
    if (!parsed) return [frame];
    const payload = asRecord(parsed.payload);
    const candidate = asRecord(asArray(payload.candidates).map(asRecord)[0]);
    const parts = asArray(asRecord(candidate.content).parts);
    this.parts.push(...parts);
    const kept = parts.filter((part) => asString(asRecord(asRecord(part).functionCall).name) !== WEB_SEARCH_TOOL_NAME);
    if (kept.length === 0) return [];
    const outgoing =
      kept.length === parts.length
        ? payload
        : { ...payload, candidates: [{ ...candidate, content: { ...asRecord(candidate.content), parts: kept } }] };
    if (!this.held) {
      this.held = outgoing;
      return [];
    }
    const previous = this.held;
    this.held = outgoing;
    return [sse(parsed.event, previous)];
  }

  public payload(): unknown {
    return { candidates: [{ content: { parts: this.parts } }] };
  }

  public finish(results: SearchResult[]): string[] {
    const final = injectCitations(this.held ?? this.payload(), results, 'gemini');
    return [sse(null, final)];
  }

  public nextRound(): void {
    this.parts = [];
    this.held = null;
  }
}

function createStreamAdapter(endpoint: SearchEndpoint): SearchStreamAdapter {
  switch (endpoint) {
    case 'responses': {
      return new ResponsesStreamAdapter();
    }
    case 'anthropic': {
      return new AnthropicStreamAdapter();
    }
    case 'gemini': {
      return new GeminiStreamAdapter();
    }
    default: {
      return new ChatStreamAdapter();
    }
  }
}

/**
Splits an upstream SSE body into frames, forwards them as they arrive, and
keeps only terminal frames (plus one Gemini frame) until tool detection is
resolved. Non-SSE bodies are returned for the caller's buffered fallback.
*/
async function relayStream(
  source: ReadableStream<Uint8Array>,
  adapter: SearchStreamAdapter,
  emit: (frame: string) => void,
  signal?: AbortSignal,
): Promise<{ rawText: string; sawFrames: boolean }> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawText = '';
  let sawFrames = false;
  const abort = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    const reason = (): Error => (signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
    if (signal.aborted) reject(reason());
    else signal.addEventListener('abort', () => reject(reason()), { once: true });
  });
  const nextRead = (): ReturnType<typeof reader.read> => reader.read();
  try {
    for (;;) {
      const read = signal ? await Promise.race([nextRead(), abort]) : await nextRead();
      if (read.done) break;
      const text = decoder.decode(read.value, { stream: true });
      rawText += text;
      const split = splitFrames(buffer + text);
      buffer = split.rest;
      for (const frame of split.frames) {
        sawFrames = true;
        for (const outgoing of adapter.observe(frame)) emit(outgoing);
      }
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
  } finally {
    reader.releaseLock();
  }
  if (buffer.trim()) {
    sawFrames = true;
    for (const outgoing of adapter.observe(buffer)) emit(outgoing);
  }
  return { rawText, sawFrames };
}

export { createStreamAdapter, relayStream, sse, splitFrames };
export type { SearchStreamAdapter };
