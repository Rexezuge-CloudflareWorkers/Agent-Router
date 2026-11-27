import { asArray, asRecord, asString } from '@agent-router/provider-clients/shared/coercion';
import { WEB_SEARCH_TOOL_NAME } from './types';
import type { SearchEndpoint, SearchToolCall } from './types';

type JsonBody = Record<string, unknown>;

const TOOL_DESCRIPTION = 'Search the web for current information. Pass a short search query.';

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

function hasToolNamed(body: JsonBody, endpoint: SearchEndpoint): boolean {
  if (endpoint === 'gemini') {
    return records(body.tools).some((tool) =>
      records(tool.functionDeclarations).some((declaration) => asString(declaration.name) === WEB_SEARCH_TOOL_NAME),
    );
  }
  return records(body.tools).some((tool) => {
    if (endpoint === 'responses' || endpoint === 'anthropic') return asString(tool.name) === WEB_SEARCH_TOOL_NAME;
    return asString(asRecord(tool.function).name) === WEB_SEARCH_TOOL_NAME;
  });
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

function queryFromArguments(value: unknown): string {
  const args = typeof value === 'string' ? JSON.parse(value) : value;
  const record = asRecord(args);
  return asString(record.query ?? record.q ?? record.search_query).trim();
}

/**
Finds the model's `web_search` call in a buffered upstream response.
*/
function findSearchToolCall(payload: unknown, endpoint: SearchEndpoint): SearchToolCall | null {
  const response = asRecord(payload);
  if (endpoint === 'chat') {
    const message = asRecord(asRecord(asArray(response.choices)[0]).message);
    for (const call of records(message.tool_calls)) {
      const fn = asRecord(call.function);
      if (asString(fn.name) !== WEB_SEARCH_TOOL_NAME) continue;
      const query = queryFromArguments(fn.arguments);
      if (query) return { id: asString(call.id) || `call_${WEB_SEARCH_TOOL_NAME}`, query };
    }
    return null;
  }
  if (endpoint === 'responses') {
    for (const item of records(response.output)) {
      if (asString(item.type) !== 'function_call' || asString(item.name) !== WEB_SEARCH_TOOL_NAME) continue;
      const query = queryFromArguments(item.arguments);
      if (query) return { id: asString(item.call_id) || asString(item.id) || `call_${WEB_SEARCH_TOOL_NAME}`, query };
    }
    return null;
  }
  if (endpoint === 'anthropic') {
    for (const item of records(response.content)) {
      if (asString(item.type) !== 'tool_use' || asString(item.name) !== WEB_SEARCH_TOOL_NAME) continue;
      const query = queryFromArguments(item.input);
      if (query) return { id: asString(item.id) || `call_${WEB_SEARCH_TOOL_NAME}`, query };
    }
    return null;
  }
  const candidate = asRecord(asArray(response.candidates)[0]);
  const parts = asArray(asRecord(candidate.content).parts).map(asRecord);
  for (const part of parts) {
    const call = asRecord(part.functionCall);
    if (asString(call.name) !== WEB_SEARCH_TOOL_NAME) continue;
    const query = queryFromArguments(call.args);
    if (query) return { id: `call_${WEB_SEARCH_TOOL_NAME}`, query };
  }
  return null;
}

/**
Appends the assistant tool call and the search result in the client's shape.
*/
function appendToolResult(body: JsonBody, endpoint: SearchEndpoint, call: SearchToolCall, content: string): void {
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
    let input = asArray(body.input);
    if (typeof body.input === 'string') {
      input = [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: body.input }] }];
    }
    input.push(
      {
        type: 'function_call',
        id: call.id,
        call_id: call.id,
        name: WEB_SEARCH_TOOL_NAME,
        arguments: JSON.stringify({ query: call.query }),
      },
      { type: 'function_call_output', call_id: call.id, output: content },
    );
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
  if (endpoint !== 'gemini') copy.stream = false;
  return copy;
}

export { appendToolResult, bufferedBody, bufferedUpstreamPath, findSearchToolCall, injectSearchTool, stripNativeSearch, TOOL_DESCRIPTION };
