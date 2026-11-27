import { asArray, asRecord, asString } from '@agent-router/provider-clients/shared/coercion';
import type { SearchEndpoint, SearchResult } from './types';

type JsonBody = Record<string, unknown>;

interface Citation {
  index: number;
  url: string;
  title: string;
  label: string;
  startIndex: number;
  endIndex: number;
}

function sse(event: string | null, data: unknown): string {
  return `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return asArray(value).map(asRecord);
}

/**
Locates text a citation can honestly point at. Falls back from an explicit
`[n]` marker to the source's domain or title, then to no span at all — a
zero-width anchor avoids highlighting the whole answer for every source.
*/
function citationSpan(result: SearchResult, position: number, text: string, lowerText: string): { start: number; end: number } | null {
  const label = `[${position + 1}]`;
  const labelled = text.indexOf(label);
  if (labelled !== -1) return { start: labelled, end: labelled + label.length };

  const domain = domainOf(result.url);
  if (domain.length >= 4) {
    const found = lowerText.indexOf(domain);
    if (found !== -1) return { start: found, end: found + domain.length };
  }
  const titleNeedle = result.title.toLowerCase().trim().slice(0, 16);
  if (titleNeedle.length >= 4) {
    const found = lowerText.indexOf(titleNeedle);
    if (found !== -1) return { start: found, end: found + titleNeedle.length };
  }
  return null;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function citationsFor(results: SearchResult[], text: string): Citation[] {
  const lowerText = text.toLowerCase();
  return results.map((result, position) => {
    const span = citationSpan(result, position, text, lowerText);
    return {
      index: position + 1,
      url: result.url,
      title: result.title,
      label: `[${position + 1}]`,
      startIndex: span?.start ?? text.length,
      endIndex: span?.end ?? text.length,
    };
  });
}

function openAiAnnotations(citations: Citation[]): Array<Record<string, unknown>> {
  return citations.map((citation) => ({
    type: 'url_citation',
    url_citation: {
      url: citation.url,
      title: citation.title,
      start_index: citation.startIndex,
      end_index: citation.endIndex,
    },
  }));
}

function anthropicCitations(citations: Citation[]): Array<Record<string, unknown>> {
  return citations.map((citation) => ({
    type: 'web_search_result_location',
    url: citation.url,
    title: citation.title,
    cited_text: citation.label,
    encrypted_index: String(citation.index),
  }));
}

/**
Adds structured citations to a buffered response in the client's shape.
*/
function injectCitations(payload: unknown, results: SearchResult[], endpoint: SearchEndpoint): JsonBody {
  const body = { ...asRecord(payload) };
  if (results.length === 0) return body;
  if (endpoint === 'chat') {
    const choices = records(body.choices);
    const choice = { ...choices[0] };
    const message = { ...asRecord(choice.message) };
    message.annotations = openAiAnnotations(citationsFor(results, asString(message.content)));
    choice.message = message;
    body.choices = [choice, ...choices.slice(1)];
    return body;
  }
  if (endpoint === 'responses') {
    const text = asString(body.output_text);
    const output = records(body.output).map((item) => {
      if (asString(item.type) !== 'message') return item;
      const content = records(item.content).map((block) => {
        if (asString(block.type) !== 'output_text') return block;
        return { ...block, annotations: openAiAnnotations(citationsFor(results, text)) };
      });
      return { ...item, content };
    });
    if (output.every((item) => !(asString(item.type) === 'message' && records(item.content).length > 0))) {
      output.push({
        type: 'message',
        id: `msg_${asString(body.id) || 'web_search'}`,
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: openAiAnnotations(citationsFor(results, text)) }],
      });
    }
    body.output = output;
    return body;
  }
  if (endpoint === 'anthropic') {
    const blocks = records(body.content);
    const citations = anthropicCitations(citationsFor(results, textOf(payload, endpoint)));
    if (blocks.some((block) => asString(block.type) === 'text')) {
      body.content = blocks.map((block) => (asString(block.type) === 'text' ? { ...block, citations } : block));
    } else {
      body.content = [...blocks, { type: 'text', text: textOf(payload, endpoint), citations }];
    }
    return body;
  }
  const candidates = records(body.candidates);
  const candidate = {
    ...candidates[0],
    groundingMetadata: {
      groundingChunks: results.map((result) => ({ web: { uri: result.url, title: result.title } })),
      groundingSupports: [],
    },
  };
  body.candidates = [candidate, ...candidates.slice(1)];
  return body;
}

function textOf(payload: unknown, endpoint: SearchEndpoint): string {
  const body = asRecord(payload);
  if (endpoint === 'chat') return asString(asRecord(asRecord(asArray(body.choices)[0]).message).content);
  if (endpoint === 'responses') return asString(body.output_text);
  if (endpoint === 'anthropic') {
    return records(body.content)
      .filter((block) => asString(block.type) === 'text')
      .map((block) => asString(block.text))
      .join('');
  }
  const candidate = asRecord(asArray(body.candidates)[0]);
  return records(asRecord(candidate.content).parts)
    .map((part) => asString(part.text))
    .join('');
}

/**
Renders a buffered upstream JSON response as client-native SSE frames.
*/
function toSse(payload: unknown, results: SearchResult[], endpoint: SearchEndpoint): string {
  const body = asRecord(payload);
  const text = textOf(payload, endpoint);
  const citations = citationsFor(results, text);
  const id = asString(body.id) || `chatcmpl-${Date.now()}`;
  const model = asString(body.model) || 'web-search';
  const created = typeof body.created === 'number' ? body.created : Math.floor(Date.now() / 1000);
  const usage = body.usage;

  if (endpoint === 'chat') {
    const chunks: string[] = [];
    const emit = (delta: Record<string, unknown>, finishReason: string | null): void => {
      const chunk: Record<string, unknown> = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      };
      if (usage) chunk.usage = usage;
      chunks.push(`data: ${JSON.stringify(chunk)}\n\n`);
    };
    emit({ role: 'assistant', content: text }, null);
    for (const call of records(asRecord(asRecord(asArray(body.choices)[0]).message).tool_calls)) {
      emit({ tool_calls: [call] }, null);
    }
    emit({ annotations: openAiAnnotations(citations) }, 'stop');
    chunks.push('data: [DONE]\n\n');
    return chunks.join('');
  }

  if (endpoint === 'responses') {
    // Use the cited payload for both the incremental frames and the final
    // response.completed so item ids and annotations never disagree.
    const cited = asRecord(injectCitations(payload, results, endpoint));
    const upstreamOutput = records(cited.output);
    const output =
      upstreamOutput.length > 0
        ? upstreamOutput
        : [
            {
              type: 'message',
              id: `msg_${id}`,
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'output_text', text, annotations: openAiAnnotations(citations) }],
            },
          ];
    const chunks: string[] = [
      sse('response.created', {
        type: 'response.created',
        response: { id, object: 'response', created_at: created, status: 'in_progress', model, output: [] },
      }),
    ];
    output.forEach((item, outputIndex) => {
      const itemType = asString(item.type);
      const itemId = asString(item.id) || (itemType === 'message' ? `msg_${id}` : `${itemType}_${outputIndex}`);
      chunks.push(
        sse('response.output_item.added', {
          type: 'response.output_item.added',
          output_index: outputIndex,
          item: { ...item, id: itemId, status: 'in_progress' },
        }),
      );
      switch (itemType) {
        case 'message': {
          records(item.content).forEach((block, contentIndex) => {
            if (asString(block.type) !== 'output_text') return;
            const blockText = asString(block.text);
            chunks.push(
              sse('response.output_text.delta', {
                type: 'response.output_text.delta',
                item_id: itemId,
                output_index: outputIndex,
                content_index: contentIndex,
                delta: blockText,
              }),
              sse('response.output_text.done', {
                type: 'response.output_text.done',
                item_id: itemId,
                output_index: outputIndex,
                content_index: contentIndex,
                text: blockText,
              }),
            );
            records(block.annotations).forEach((annotation, annotationIndex) => {
              chunks.push(
                sse('response.output_text.annotation.added', {
                  type: 'response.output_text.annotation.added',
                  item_id: itemId,
                  output_index: outputIndex,
                  content_index: contentIndex,
                  annotation_index: annotationIndex,
                  annotation,
                }),
              );
            });
          });

          break;
        }
        case 'reasoning': {
          const summary = records(item.summary)
            .map((part) => asString(part.text))
            .join('');
          if (summary) {
            chunks.push(
              sse('response.reasoning_text.delta', {
                type: 'response.reasoning_text.delta',
                item_id: itemId,
                output_index: outputIndex,
                summary_index: 0,
                delta: summary,
              }),
              sse('response.reasoning_text.done', {
                type: 'response.reasoning_text.done',
                item_id: itemId,
                output_index: outputIndex,
                summary_index: 0,
                text: summary,
              }),
            );
          }

          break;
        }
        case 'function_call': {
          const args = asString(item.arguments);
          if (args) {
            chunks.push(
              sse('response.function_call_arguments.delta', {
                type: 'response.function_call_arguments.delta',
                item_id: itemId,
                output_index: outputIndex,
                delta: args,
              }),
              sse('response.function_call_arguments.done', {
                type: 'response.function_call_arguments.done',
                item_id: itemId,
                output_index: outputIndex,
                arguments: args,
              }),
            );
          }

          break;
        }
        // No default
      }
      chunks.push(
        sse('response.output_item.done', {
          type: 'response.output_item.done',
          output_index: outputIndex,
          item: { ...item, id: itemId, status: 'completed' },
        }),
      );
    });
    chunks.push(sse('response.completed', { type: 'response.completed', response: cited }));
    return chunks.join('');
  }

  if (endpoint === 'anthropic') {
    const tokenUsage = asRecord(usage);
    return [
      sse('message_start', {
        type: 'message_start',
        message: { id, type: 'message', role: 'assistant', model, content: [], usage: tokenUsage },
      }),
      sse('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '', ...(results.length > 0 && { citations: anthropicCitations(citations) }) },
      }),
      sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
      sse('content_block_stop', { type: 'content_block_stop', index: 0 }),
      sse('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: tokenUsage }),
      sse('message_stop', { type: 'message_stop' }),
    ].join('');
  }

  return sse(null, injectCitations(body, results, endpoint));
}

export { anthropicCitations, citationsFor, injectCitations, openAiAnnotations, textOf, toSse };
