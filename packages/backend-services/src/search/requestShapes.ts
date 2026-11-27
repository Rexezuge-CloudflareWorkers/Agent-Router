import { asArray, asRecord, asString } from '@agent-router/provider-clients/shared/coercion';
import { WEB_SEARCH_TOOL_NAME } from './types';
import type { SearchEndpoint, SearchToolCall } from './types';

type JsonBody = Record<string, unknown>;

const TOOL_DESCRIPTION = 'Search the web for current information. Pass a short search query.';
const ANSWER_DIRECTIVE =
  'Stop searching. Answer the question now using only the web search results above. Cite each source you use with its bracketed [n] number.';

function records(value: unknown): Array<Record<string, unknown>> {
  return asArray(value).map(asRecord);
}

function isNativeSearchTool(tool: Record<string, unknown>, endpoint: SearchEndpoint): boolean {
  if (endpoint === 'gemini') return 'googleSearch' in tool || 'google_search' in tool;
  return asString(tool.type).startsWith('web_search');
}

/**
Removes provider-native web search flags so a mode change cannot double
search (or silently enable search when the user chose 'none').
*/
function stripNativeSearch(body: JsonBody, endpoint: SearchEndpoint): boolean {
  let changed = false;
  for (const key of ['web_search_options', 'web_search']) {
    if (!(key in body)) {
      continue;
    }

    delete body[key];
    changed = true;
  }
  if (Array.isArray(body.tools)) {
    const kept = body.tools.filter((tool) => !isNativeSearchTool(asRecord(tool), endpoint));
    if (kept.length !== body.tools.length) {
      body.tools = kept;
      changed = true;
    }
  }
  return changed;
}

function isGenericSearchTool(tool: Record<string, unknown>, endpoint: SearchEndpoint): boolean {
  if (endpoint === 'gemini') {
    return records(tool.functionDeclarations).some((declaration) => asString(declaration.name) === WEB_SEARCH_TOOL_NAME);
  }
  if (endpoint === 'responses' || endpoint === 'anthropic') return asString(tool.name) === WEB_SEARCH_TOOL_NAME;
  return asString(asRecord(tool.function).name) === WEB_SEARCH_TOOL_NAME;
}

function hasToolNamed(body: JsonBody, endpoint: SearchEndpoint): boolean {
  return records(body.tools).some((tool) => isGenericSearchTool(tool, endpoint));
}

/**
Adds one generic `web_search` function tool in the client's native shape.
*/
function injectSearchTool(body: JsonBody, endpoint: SearchEndpoint): void {
  if (hasToolNamed(body, endpoint)) return;
  const tools = records(body.tools);
  if (endpoint === 'gemini') {
    const declarations = records(tools[0]?.functionDeclarations);
    declarations.push({
      name: WEB_SEARCH_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' } }, required: ['query'] },
    });
    const first = { ...tools[0], functionDeclarations: declarations };
    body.tools = [first, ...tools.slice(1)];
    return;
  }
  if (endpoint === 'anthropic') {
    tools.push({
      name: WEB_SEARCH_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    });
  } else if (endpoint === 'responses') {
    tools.push({
      type: 'function',
      name: WEB_SEARCH_TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    });
  } else {
    tools.push({
      type: 'function',
      function: {
        name: WEB_SEARCH_TOOL_NAME,
        description: TOOL_DESCRIPTION,
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
    });
  }
  body.tools = tools;
}

/**
Forces the injected tool in the client's native shape. Returns a restore
closure so the final no-tool call does not inherit a choice naming a tool
that has just been removed.
*/
function forceSearchTool(body: JsonBody, endpoint: SearchEndpoint): () => void {
  const original = { tool_choice: body.tool_choice, toolConfig: body.toolConfig };
  switch (endpoint) {
    case 'gemini': {
      body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [WEB_SEARCH_TOOL_NAME] } };

      break;
    }
    case 'anthropic': {
      body.tool_choice = { type: 'tool', name: WEB_SEARCH_TOOL_NAME };

      break;
    }
    case 'responses': {
      body.tool_choice = { type: 'function', name: WEB_SEARCH_TOOL_NAME };

      break;
    }
    default: {
      body.tool_choice = { type: 'function', function: { name: WEB_SEARCH_TOOL_NAME } };
    }
  }
  return () => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete body[key];
      else body[key] = value;
    }
  };
}

/**
Drops only our injected tool, preserving any tools the client supplied.
*/
function removeSearchTool(body: JsonBody, endpoint: SearchEndpoint): void {
  if (!Array.isArray(body.tools)) return;
  if (endpoint === 'gemini') {
    body.tools = records(body.tools)
      .map((tool) => ({
        ...tool,
        functionDeclarations: records(tool.functionDeclarations).filter(
          (declaration) => asString(declaration.name) !== WEB_SEARCH_TOOL_NAME,
        ),
      }))
      .filter((tool) => records(tool.functionDeclarations).length > 0 || Object.keys(tool).some((key) => key !== 'functionDeclarations'));
    return;
  }
  body.tools = records(body.tools).filter((tool) => !isGenericSearchTool(tool, endpoint));
}

function queryFromArguments(value: unknown): string {
  const args = typeof value === 'string' ? JSON.parse(value) : value;
  const record = asRecord(args);
  return asString(record.query ?? record.q ?? record.search_query).trim();
}

/**
Finds every `web_search` call in a buffered upstream response. Dedupe by id
so a malformed response cannot make the same search run twice.
*/
function findSearchToolCalls(payload: unknown, endpoint: SearchEndpoint): SearchToolCall[] {
  const response = asRecord(payload);
  const found: SearchToolCall[] = [];
  const seen = new Set<string>();
  const push = (id: string, query: string, itemId?: string): void => {
    const key = `${id}:${query}`;
    if (!query || seen.has(key)) return;
    seen.add(key);
    found.push({ id: id || `call_${WEB_SEARCH_TOOL_NAME}_${found.length}`, ...(itemId && { itemId }), query });
  };

  if (endpoint === 'chat') {
    const message = asRecord(asRecord(asArray(response.choices)[0]).message);
    for (const call of records(message.tool_calls)) {
      const fn = asRecord(call.function);
      if (asString(fn.name) !== WEB_SEARCH_TOOL_NAME) continue;
      push(asString(call.id) || `call_${WEB_SEARCH_TOOL_NAME}_${found.length}`, queryFromArguments(fn.arguments));
    }
    return found;
  }
  if (endpoint === 'responses') {
    for (const item of records(response.output)) {
      if (asString(item.type) !== 'function_call' || asString(item.name) !== WEB_SEARCH_TOOL_NAME) continue;
      const itemId = asString(item.id);
      push(asString(item.call_id) || itemId, queryFromArguments(item.arguments), itemId);
    }
    return found;
  }
  if (endpoint === 'anthropic') {
    for (const item of records(response.content)) {
      if (asString(item.type) !== 'tool_use' || asString(item.name) !== WEB_SEARCH_TOOL_NAME) continue;
      push(asString(item.id), queryFromArguments(item.input));
    }
    return found;
  }
  const candidate = asRecord(asArray(response.candidates)[0]);
  for (const [index, part] of asArray(asRecord(candidate.content).parts).map(asRecord).entries()) {
    const call = asRecord(part.functionCall);
    if (asString(call.name) !== WEB_SEARCH_TOOL_NAME) continue;
    push(`call_${WEB_SEARCH_TOOL_NAME}_${index}`, queryFromArguments(call.args));
  }
  return found;
}

function findSearchToolCall(payload: unknown, endpoint: SearchEndpoint): SearchToolCall | null {
  return findSearchToolCalls(payload, endpoint)[0] ?? null;
}

function inputArray(body: JsonBody): unknown[] {
  if (Array.isArray(body.input)) return body.input;
  if (typeof body.input === 'string') {
    return [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }];
  }
  return [];
}

/**
Appends the assistant tool calls and their search results in the client's shape.
*/
function appendToolResults(
  body: JsonBody,
  endpoint: SearchEndpoint,
  calls: SearchToolCall[],
  contents: string[],
  options: { replayAssistantCall?: boolean } = {},
): void {
  calls.forEach((call, index) => appendToolResult(body, endpoint, call, contents[index] ?? '', options));
}

/**
Appends one assistant tool call and its search result in the client's shape.
*/
function appendToolResult(
  body: JsonBody,
  endpoint: SearchEndpoint,
  call: SearchToolCall,
  content: string,
  options: { replayAssistantCall?: boolean } = {},
): void {
  if (endpoint === 'chat') {
    const messages = records(body.messages);
    messages.push(
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: call.id, type: 'function', function: { name: WEB_SEARCH_TOOL_NAME, arguments: JSON.stringify({ query: call.query }) } },
        ],
      },
      { role: 'tool', tool_call_id: call.id, content },
    );
    body.messages = messages;
    return;
  }
  if (endpoint === 'responses') {
    const input = inputArray(body);
    // A stored response already contains the *first* assistant function_call;
    // replaying that one alongside previous_response_id is rejected by the
    // Responses API. Later rounds must replay their own calls so each tool
    // output references an item the upstream can see.
    if (options.replayAssistantCall !== false) {
      input.push({
        type: 'function_call',
        id: call.itemId ?? call.id,
        call_id: call.id,
        name: WEB_SEARCH_TOOL_NAME,
        arguments: JSON.stringify({ query: call.query }),
      });
    }
    input.push({ type: 'function_call_output', call_id: call.id, output: content });
    body.input = input;
    return;
  }
  if (endpoint === 'anthropic') {
    const messages = records(body.messages);
    messages.push(
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: call.id, name: WEB_SEARCH_TOOL_NAME, input: { query: call.query } }],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content }] },
    );
    body.messages = messages;
    return;
  }
  const contents = records(body.contents);
  contents.push(
    {
      role: 'model',
      parts: [{ functionCall: { name: WEB_SEARCH_TOOL_NAME, args: { query: call.query } } }],
    },
    {
      role: 'user',
      parts: [{ functionResponse: { name: WEB_SEARCH_TOOL_NAME, response: { output: content } } }],
    },
  );
  body.contents = contents;
}

/**
Tells the model to stop searching and answer from the results already collected.
*/
function appendAnswerDirective(body: JsonBody, endpoint: SearchEndpoint): void {
  if (endpoint === 'chat' || endpoint === 'anthropic') {
    const messages = records(body.messages);
    messages.push({ role: 'user', content: ANSWER_DIRECTIVE });
    body.messages = messages;
    return;
  }
  if (endpoint === 'responses') {
    const input = inputArray(body);
    input.push({ type: 'message', role: 'user', content: [{ type: 'input_text', text: ANSWER_DIRECTIVE }] });
    body.input = input;
    return;
  }
  const contents = records(body.contents);
  contents.push({ role: 'user', parts: [{ text: ANSWER_DIRECTIVE }] });
  body.contents = contents;
}

/**
Streaming Gemini traffic must use the buffered upstream path here.
*/
function bufferedUpstreamPath(endpoint: SearchEndpoint, upstreamPath: string): string {
  return endpoint === 'gemini' ? upstreamPath.replace(':streamGenerateContent', ':generateContent') : upstreamPath;
}

/**
Force a buffered call so a tool call can be detected deterministically.
*/
function bufferedBody(body: JsonBody, endpoint: SearchEndpoint): JsonBody {
  const copy = { ...body };
  if (endpoint !== 'gemini') {
    copy.stream = false;
    // stream_options is only legal on streaming upstream calls. Removing it
    // here keeps forced buffering from turning into an upstream 400.
    delete copy.stream_options;
  }
  return copy;
}

export {
  ANSWER_DIRECTIVE,
  appendAnswerDirective,
  appendToolResult,
  appendToolResults,
  bufferedBody,
  bufferedUpstreamPath,
  findSearchToolCall,
  findSearchToolCalls,
  forceSearchTool,
  injectSearchTool,
  removeSearchTool,
  stripNativeSearch,
  TOOL_DESCRIPTION,
};
