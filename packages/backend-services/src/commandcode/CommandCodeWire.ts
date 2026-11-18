interface WireOptions {
  protocolVersion: string;
  deviceProjectDir: string;
  cliMode: string;
  emptySystemPlaceholder: boolean;
  zdr: boolean;
  sessionId: string | null;
}

const FALLBACK_MODEL = 'deepseek/deepseek-v4-flash';
const MAX_TOKENS_CAP = 200_000;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : JSON.stringify(value);
}

function slugifyProjectPath(path: string): string {
  return (
    path
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replace(/^-/, '')
      .replace(/-$/, '') || 'root'
  );
}

function isWireUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function generateTraceparent(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`;
}

function toWireToolOutput(content: unknown): string {
  if (typeof content === 'string') return content;
  return Array.isArray(content)
    ? content
        .map((part) => asRecord(part))
        .filter((part) => part.type === 'text')
        .map((part) => asString(part.text))
        .join('\n')
    : asText(content);
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function buildSystemBlocks(messages: unknown[]): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  for (const raw of messages) {
    const message = asRecord(raw);
    if (message.role !== 'system' && message.role !== 'developer') continue;
    const content = message.content;
    if (typeof content === 'string') {
      if (content) blocks.push({ type: 'text', text: content });
    } else if (Array.isArray(content)) {
      for (const rawPart of content) {
        const part = asRecord(rawPart);
        const text = part.text ?? part.content ?? '';
        if (text === '' && !part.cache_control) continue;
        const block: Record<string, unknown> = { type: 'text', text: asText(text) };
        if (part.cache_control) block.cache_control = part.cache_control;
        blocks.push(block);
      }
    } else if (content != null) {
      blocks.push({ type: 'text', text: asText(content) });
    }
  }
  for (let index = 0; index < blocks.length - 1; index += 1) blocks[index].text = `${asString(blocks[index].text)}\n`;
  return blocks;
}

function buildMessages(messages: unknown[]): Array<Record<string, unknown>> {
  const chatMessages = messages.map(asRecord).filter((message) => message.role !== 'system' && message.role !== 'developer');
  const toolNames = new Map<string, string>();
  for (const message of chatMessages) {
    if (message.role !== 'assistant') continue;
    for (const rawCall of asArray(message.tool_calls)) {
      const call = asRecord(rawCall);
      if (typeof call.id === 'string' && call.id) toolNames.set(call.id, asString(asRecord(call.function).name));
    }
  }

  return chatMessages.map((message) => {
    if (message.role === 'user') {
      if (typeof message.content === 'string') return { role: 'user', content: [{ type: 'text', text: message.content }] };
      if (Array.isArray(message.content)) {
        const parts = message.content.map((rawPart) => {
          const part = asRecord(rawPart);
          if (part.type !== 'image_url') return part;
          const url = asString(asRecord(part.image_url).url);
          const mediaType = /^data:([^;,]+)/.exec(url)?.[1];
          const imagePart: Record<string, unknown> = { type: 'image', image: url };
          if (mediaType) imagePart.mimeType = mediaType;
          return imagePart;
        });
        return { role: 'user', content: parts };
      }
      return { role: 'user', content: [{ type: 'text', text: asText(message.content) }] };
    }
    if (message.role === 'assistant') {
      const parts: Array<Record<string, unknown>> = [];
      if (typeof message.reasoning_content === 'string' && message.reasoning_content) {
        parts.push({ type: 'reasoning', text: message.reasoning_content });
      }
      if (typeof message.content === 'string') {
        if (message.content) parts.push({ type: 'text', text: message.content });
      } else if (Array.isArray(message.content)) {
        for (const rawPart of message.content) {
          const part = asRecord(rawPart);
          if (part.type === 'text' || (part.type === 'reasoning' && !message.reasoning_content)) parts.push(part);
        }
      }
      for (const rawCall of asArray(message.tool_calls)) {
        const call = asRecord(rawCall);
        const fn = asRecord(call.function);
        parts.push({
          type: 'tool-call',
          toolCallId: call.id,
          toolName: asString(fn.name),
          input: parseArguments(fn.arguments),
        });
      }
      return { role: 'assistant', content: parts };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: asString(message.tool_call_id),
            toolName: toolNames.get(asString(message.tool_call_id)) ?? asString(message.name),
            output: { type: 'text', value: toWireToolOutput(message.content) },
          },
        ],
      };
    }
    return { role: 'user', content: [{ type: 'text', text: asText(message.content) }] };
  });
}

function buildTools(tools: unknown): Array<Record<string, unknown>> {
  return asArray(tools).map((rawTool) => {
    const tool = asRecord(rawTool);
    const fn = asRecord(tool.function);
    return {
      name: asString(fn.name ?? tool.name),
      description: asString(fn.description ?? tool.description),
      input_schema: fn.parameters ?? tool.input_schema ?? { type: 'object', properties: {} },
    };
  });
}

function buildCommandCodeEnvelope(chatBody: unknown, options: WireOptions): Record<string, unknown> {
  const body = asRecord(chatBody);
  const messages = asArray(body.messages);
  const systemBlocks = buildSystemBlocks(messages);
  const ccMessages = buildMessages(messages);
  const promptCacheKey = asString(body.prompt_cache_key);

  if (promptCacheKey && systemBlocks.length > 0) {
    const hasMarker =
      systemBlocks.some((block) => block.cache_control) ||
      ccMessages.some((message) => asArray(message.content).some((part) => asRecord(part).cache_control));
    const lastSystemBlock = systemBlocks.at(-1);
    if (!hasMarker && lastSystemBlock) lastSystemBlock.cache_control = { type: 'ephemeral' };
  }

  const params: Record<string, unknown> = {
    model: asString(body.model) || FALLBACK_MODEL,
    messages: ccMessages,
    max_tokens: Math.min(Number(body.max_tokens) || 64_000, MAX_TOKENS_CAP),
    stream: true,
  };
  if (systemBlocks.length > 0) params.system = systemBlocks;
  else if (options.emptySystemPlaceholder) params.system = [{ type: 'text', text: ' ' }];
  if (body.temperature !== undefined) params.temperature = body.temperature;
  if (body.reasoning_effort !== undefined) params.reasoning_effort = body.reasoning_effort;

  params.tools = buildTools(body.tools);
  if (body.tool_choice !== undefined) {
    const choice = body.tool_choice;
    if (choice === 'none' || asRecord(choice).type === 'none') {
      params.tools = [];
    } else if (typeof choice === 'string') {
      params.tool_choice = { type: choice === 'required' ? 'any' : 'auto' };
    } else if (asRecord(choice).type === 'function') {
      params.tool_choice = { type: 'tool', name: asRecord(choice).function ? asRecord(asRecord(choice).function).name : undefined };
    } else {
      params.tool_choice = choice;
    }
  }
  if (body.parallel_tool_calls !== undefined) params.parallel_tool_calls = body.parallel_tool_calls;

  const envelope: Record<string, unknown> = {
    config: {
      workingDir: options.deviceProjectDir,
      date: new Date().toISOString().slice(0, 10),
      environment: 'win32',
      structure: [],
      isGitRepo: false,
      currentBranch: '',
      mainBranch: '',
      gitStatus: '',
      recentCommits: [],
    },
    memory: null,
    taste: null,
    skills: null,
    permissionMode: 'standard',
    mode: options.cliMode || 'agent',
    params,
  };
  if (options.sessionId && isWireUuid(options.sessionId)) {
    const ordered: Record<string, unknown> = {};
    for (const key of ['config', 'memory', 'taste', 'skills', 'permissionMode']) ordered[key] = envelope[key];
    ordered.threadId = options.sessionId;
    ordered.mode = envelope.mode;
    ordered.params = envelope.params;
    return ordered;
  }
  return envelope;
}

async function deriveSessionId(secret: string, envelope: Record<string, unknown>): Promise<string> {
  const params = asRecord(envelope.params);
  const parts: string[] = [secret, asString(params.model)];
  for (const rawBlock of asArray(params.system)) parts.push(asString(asRecord(rawBlock).text));
  for (const rawMessage of asArray(params.messages)) {
    const message = asRecord(rawMessage);
    if (message.role !== 'user') break;
    for (const rawPart of asArray(message.content)) {
      const part = asRecord(rawPart);
      if (part.type === 'text') parts.push(asString(part.text));
    }
  }
  // SHA-1 is used only to derive a stable pseudo-random session UUID, not for
  // any security-sensitive purpose.
  // eslint-disable-next-line sonarjs/hashing
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(parts.join('\0')));
  const bytes = new Uint8Array(digest).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function resolveSessionId(
  incoming: Record<string, string | undefined>,
  secret: string,
  envelope: Record<string, unknown>,
  promptCacheKey: string,
): Promise<string> {
  const candidates = [incoming['x-session-id'], incoming['x-claude-code-session-id'], incoming.session_id, promptCacheKey];
  for (const candidate of candidates) {
    if (candidate && candidate.length >= 8) return Promise.resolve(candidate);
  }
  return deriveSessionId(secret, envelope);
}

function buildCommandCodeHeaders(input: {
  secret: string;
  sessionId: string;
  projectDir: string;
  protocolVersion: string;
  zdr: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'cli',
    'x-command-code-version': input.protocolVersion,
    'x-cli-environment': 'production',
    'x-project-slug': slugifyProjectPath(input.projectDir),
    'x-taste-learning': 'false',
    'x-session-id': input.sessionId,
    authorization: `Bearer ${input.secret}`,
    traceparent: generateTraceparent(),
  };
  if (input.zdr) headers['x-cmd-zdr'] = '1';
  return headers;
}

export {
  buildCommandCodeEnvelope,
  buildCommandCodeHeaders,
  buildTools,
  deriveSessionId,
  isWireUuid,
  resolveSessionId,
  slugifyProjectPath,
  toWireToolOutput,
};
export type { WireOptions };
