/* eslint-disable unicorn/prefer-switch -- else-if chains avoid break-in-nested-loop */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      const record = asRecord(part);
      return typeof record.text === 'string' ? record.text : '';
    })
    .join('');
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : JSON.stringify(value);
}

function imagePart(url: string, detail?: string): Record<string, unknown> {
  return { type: 'image_url', image_url: { url, ...(detail && { detail }) } };
}

function isImagePart(part: Record<string, unknown>): boolean {
  return part.type === 'input_image' && typeof part.image_url === 'string';
}

function responseToolOutput(output: unknown): { text: string; images: Array<Record<string, unknown>> } {
  if (typeof output === 'string') return { text: output, images: [] };
  if (!Array.isArray(output)) return { text: asText(output), images: [] };
  const texts: string[] = [];
  const images: Array<Record<string, unknown>> = [];
  for (const rawPart of output) {
    const part = asRecord(rawPart);
    if (part.type === 'input_text' || part.type === 'output_text') texts.push(asString(part.text));
    else if (part.type === 'input_image' && typeof part.image_url === 'string') images.push(imagePart(part.image_url));
    else if (typeof part.text === 'string') texts.push(part.text);
  }
  return { text: texts.join('\n'), images };
}

/**
 * Responses API request → OpenAI Chat Completions request. Mirrors the
 * stateless conversion used by commandcode-proxy: reasoning / message /
 * function_call items are regrouped under one assistant message, and images
 * returned by parallel tool calls are collected after all tool results.
 */
function convertResponsesToChat(responsesRequest: unknown): Record<string, unknown> {
  const request = asRecord(responsesRequest);
  const messages: Array<Record<string, unknown>> = [];
  const instructions = textOfContent(request.instructions);
  if (instructions) messages.push({ role: 'system', content: instructions });

  let pending: Record<string, unknown> | null = null;
  let pendingToolImages: Array<Record<string, unknown>> = [];
  const flushToolImages = (): void => {
    if (pendingToolImages.length === 0) return;
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: '[images returned by tool calls]' }, ...pendingToolImages],
    });
    pendingToolImages = [];
  };
  const ensurePending = (): Record<string, unknown> => {
    pending ??= { role: 'assistant', content: null, tool_calls: [] };
    return pending;
  };
  const flushPending = (): void => {
    if (!pending) return;
    messages.push(pending);
    pending = null;
  };

  const input = request.input;
  if (typeof input === 'string') {
    messages.push({ role: 'user', content: input });
  } else {
    for (const rawItem of asArray(input)) {
      const item = asRecord(rawItem);
      if (item.type === 'message' || item.role) {
        flushPending();
        flushToolImages();
        const role = asString(item.role) || 'user';
        const content = item.content;
        if (role === 'assistant') {
          if (typeof content === 'string') messages.push({ role: 'assistant', content });
          else {
            const parts = asArray(content).map((rawPart) => {
              const part = asRecord(rawPart);
              return part.type === 'output_text' ? { type: 'text', text: asString(part.text) } : part;
            });
            messages.push({ role: 'assistant', content: parts });
          }
        } else if (typeof content === 'string') {
          messages.push({ role, content });
        } else {
          const parts: Array<Record<string, unknown>> = [];
          for (const rawPart of asArray(content)) {
            const part = asRecord(rawPart);
            if (part.type === 'input_text' || part.type === 'output_text') parts.push({ type: 'text', text: asString(part.text) });
            else if (isImagePart(part)) parts.push(imagePart(asString(part.image_url), asString(part.detail)));
            else parts.push(part);
          }
          messages.push({ role, content: parts });
        }
      } else if (item.type === 'reasoning') {
        const summary = asArray(item.summary)
          .map((raw) => asString(asRecord(raw).text))
          .join('\n');
        const content = asArray(item.content)
          .map((raw) => asString(asRecord(raw).text))
          .join('\n');
        const text = summary || content;
        if (text) ensurePending().reasoning_content = text;
      } else if (item.type === 'function_call') {
        const target = ensurePending();
        const calls = (target.tool_calls as Array<Record<string, unknown>>) ?? [];
        calls.push({
          id: asString(item.call_id) || asString(item.id),
          type: 'function',
          function: { name: asString(item.name), arguments: asString(item.arguments) },
        });
        target.tool_calls = calls;
      } else if (item.type === 'function_call_output') {
        flushPending();
        const { text, images } = responseToolOutput(item.output);
        messages.push({ role: 'tool', tool_call_id: asString(item.call_id), content: text });
        pendingToolImages.push(...images);
      }
    }
    flushPending();
    flushToolImages();
  }

  const chat: Record<string, unknown> = {
    model: asString(request.model),
    messages,
    max_tokens: request.max_output_tokens,
    temperature: request.temperature,
  };
  if (request.stream !== undefined) chat.stream = request.stream;
  if (request.reasoning !== undefined) chat.reasoning_effort = asRecord(request.reasoning).effort;
  if (request.tools !== undefined) {
    chat.tools = asArray(request.tools)
      .map((rawTool) => {
        const tool = asRecord(rawTool);
        if (tool.type !== 'function') return null;
        return {
          type: 'function',
          function: {
            name: asString(tool.name),
            description: asString(tool.description),
            parameters: tool.parameters ?? { type: 'object', properties: {} },
          },
        };
      })
      .filter(Boolean);
  }
  if (request.tool_choice !== undefined) chat.tool_choice = request.tool_choice;
  if (request.parallel_tool_calls !== undefined) chat.parallel_tool_calls = request.parallel_tool_calls;
  if (request.prompt_cache_key !== undefined) chat.prompt_cache_key = request.prompt_cache_key;
  return chat;
}

function anthropicToolChoice(choice: unknown): unknown {
  const record = asRecord(choice);
  if (record.type === 'auto') return 'auto';
  if (record.type === 'any') return 'required';
  if (record.type === 'none') return 'none';
  return record.type === 'tool' ? { type: 'function', function: { name: asString(record.name) } } : choice;
}

/**
 * Anthropic Messages request → OpenAI Chat Completions request.
 */
function convertAnthropicToChat(anthropicRequest: unknown): Record<string, unknown> {
  const request = asRecord(anthropicRequest);
  const system = request.system;
  let systemContent: unknown = '';
  if (typeof system === 'string') systemContent = system;
  else if (Array.isArray(system)) {
    const blocks = system
      .map((raw) => asRecord(raw))
      .filter((block) => block.type === 'text')
      .map((block) => {
        const mapped: Record<string, unknown> = { type: 'text', text: asString(block.text) };
        if (block.cache_control) mapped.cache_control = block.cache_control;
        return mapped;
      });
    systemContent = blocks;
  }

  const messages: Array<Record<string, unknown>> = [];
  if (systemContent && (typeof systemContent !== 'string' || systemContent)) messages.push({ role: 'system', content: systemContent });

  for (const rawMessage of asArray(request.messages)) {
    const message = asRecord(rawMessage);
    const role = asString(message.role);
    const content = message.content;
    if (typeof content === 'string') {
      // Anthropic clients commonly send a plain string for user/assistant content.
      if (role === 'assistant') messages.push({ role: 'assistant', content });
      else if (role === 'user') messages.push({ role: 'user', content });
    } else if (role === 'assistant') {
      let text = '';
      let reasoning = '';
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const rawPart of asArray(content)) {
        const part = asRecord(rawPart);
        if (part.type === 'text') {
          text += asString(part.text);
        } else if (part.type === 'thinking') {
          reasoning += asString(part.thinking) || asString(part.text);
        } else if (part.type === 'tool_use') {
          toolCalls.push({
            id: asString(part.id),
            type: 'function',
            function: { name: asString(part.name), arguments: asText(part.input ?? {}) },
          });
        }
      }
      const assistant: Record<string, unknown> = { role: 'assistant', content: text || null };
      if (reasoning) assistant.reasoning_content = reasoning;
      if (toolCalls.length > 0) assistant.tool_calls = toolCalls;
      messages.push(assistant);
    } else if (role === 'user') {
      const parts: Array<Record<string, unknown>> = [];
      for (const rawPart of asArray(content)) {
        const part = asRecord(rawPart);
        if (part.type === 'tool_result') {
          const resultContent = part.content;
          let text = '';
          const images: Array<Record<string, unknown>> = [];
          if (typeof resultContent === 'string') text = resultContent;
          else {
            for (const rawInner of asArray(resultContent)) {
              const inner = asRecord(rawInner);
              if (inner.type === 'text') text += asString(inner.text);
              else if (inner.type === 'image') {
                const source = asRecord(inner.source);
                const url = asString(source.url);
                if (url) images.push(imagePart(url));
              }
            }
          }
          messages.push({ role: 'tool', tool_call_id: asString(part.tool_use_id), content: text });
          parts.push(...images);
        } else if (part.type === 'text') {
          const block: Record<string, unknown> = { type: 'text', text: asString(part.text) };
          if (part.cache_control) block.cache_control = part.cache_control;
          parts.push(block);
        } else if (part.type === 'image') {
          const source = asRecord(part.source);
          const url = asString(source.url);
          if (url) parts.push(imagePart(url));
        }
      }
      if (parts.length > 0) messages.push({ role: 'user', content: parts });
    }
  }

  const chat: Record<string, unknown> = {
    model: asString(request.model),
    messages,
    max_tokens: request.max_tokens,
    temperature: request.temperature,
  };
  if (request.stream !== undefined) chat.stream = request.stream;
  if (request.stop_sequences !== undefined) chat.stop = request.stop_sequences;
  if (request.tools !== undefined) {
    chat.tools = asArray(request.tools).map((rawTool) => {
      const tool = asRecord(rawTool);
      return {
        type: 'function',
        function: {
          name: asString(tool.name),
          description: asString(tool.description),
          parameters: tool.input_schema ?? { type: 'object', properties: {} },
        },
      };
    });
  }
  if (request.tool_choice !== undefined) chat.tool_choice = anthropicToolChoice(request.tool_choice);
  if (request.metadata !== undefined) chat.metadata = request.metadata;
  return chat;
}

export { convertAnthropicToChat, convertResponsesToChat };
