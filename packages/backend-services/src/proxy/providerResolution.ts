import type { Container } from '@agent-router/backend-runtime/di';
import type { ProviderKind } from '@agent-router/shared';
import { BadRequestError, NotFoundError } from '@rexezuge/errors';
import { Tokens } from '../composition/index';

const COMMAND_CODE_MODEL_PREFIXES = [
  'deepseek/',
  'moonshotai/',
  'zai-org/',
  'minimaxai/',
  'qwen/',
  'stepfun/',
  'xiaomi/',
  'google/gemini-',
];

function inferKind(model: unknown): ProviderKind | null {
  if (typeof model !== 'string') return null;
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 'ANTHROPIC';
  if (m.startsWith('gemini-') || m.startsWith('models/gemini-')) return 'GEMINI';
  if (COMMAND_CODE_MODEL_PREFIXES.some((prefix) => m.startsWith(prefix))) return 'COMMAND_CODE';
  return m.startsWith('gpt-') ||
    m.startsWith('o1-') ||
    m.startsWith('o3-') ||
    m.startsWith('o4-') ||
    m.startsWith('text-embedding-') ||
    m.startsWith('whisper-') ||
    m.startsWith('dall-e-') ||
    m.startsWith('tts-')
    ? 'OPENAI'
    : null;
}

/**
Native provider search is not supported by Command Code (its converters
drop those fields), so those keys are excluded before failover. A missing
settings token in a test container simply leaves the filter empty.
*/
async function nativeSearchExclusions(scope: Container, userEmail: string): Promise<ReadonlySet<ProviderKind>> {
  try {
    const settings = await scope.get(Tokens.WebSearchSettingsService).getSettings(userEmail);
    return settings.mode === 'native' ? new Set<ProviderKind>(['COMMAND_CODE']) : new Set<ProviderKind>();
  } catch {
    return new Set<ProviderKind>();
  }
}

async function resolveProviderId(
  scope: Container,
  userEmail: string,
  opts: { kind: ProviderKind | null; explicitId: string | null; excludeKinds?: ReadonlySet<ProviderKind> },
): Promise<{ id: string; kind: ProviderKind; baseUrl: string | null }> {
  const svc = scope.get(Tokens.ProviderService);
  const all = await svc.listProviders(userEmail);
  const excluded = opts.excludeKinds ?? new Set<ProviderKind>();
  const providers = all.filter((p) => p.status === 'active' && !excluded.has(p.kind));
  if (providers.length === 0 && excluded.size > 0) {
    throw new BadRequestError('Web search is unavailable for the configured providers; add an OpenAI, Anthropic or Gemini provider.');
  }
  if (opts.explicitId) {
    const found = providers.find((p) => p.id === opts.explicitId);
    if (!found) throw new NotFoundError('Provider not found');
    return { id: found.id, kind: found.kind, baseUrl: found.baseUrl };
  }
  if (opts.kind) {
    const found = providers.find((p) => p.kind === opts.kind);
    if (found) return { id: found.id, kind: found.kind, baseUrl: found.baseUrl };
    // Responses requests fall back to Codex OAuth when no static OpenAI
    // provider exists (chat/embeddings via Codex are rejected below with
    // guidance — the Codex backend only serves the Responses API).
    if (opts.kind === 'OPENAI') {
      const codex = providers.find((p) => p.kind === 'OPENAI_CODEX');
      if (codex) return { id: codex.id, kind: codex.kind, baseUrl: codex.baseUrl };
    }
    // Anthropic-shaped traffic can be served by Command Code (it speaks the
    // Messages API), so fall back when no Anthropic provider is configured.
    // Unknown model prefixes are also common for Command Code's namespaced
    // models, so use the only active Command Code provider instead of failing.
    if (opts.kind === 'OPENAI' || opts.kind === 'ANTHROPIC') {
      const commandCode = providers.find((p) => p.kind === 'COMMAND_CODE');
      if (commandCode) return { id: commandCode.id, kind: commandCode.kind, baseUrl: commandCode.baseUrl };
    }
    throw new NotFoundError(`No active ${opts.kind} provider. Add one under /user/providers.`);
  }
  const fallback = providers[0];
  if (!fallback) throw new NotFoundError('No providers configured. Add one under /user/providers.');
  return { id: fallback.id, kind: fallback.kind, baseUrl: fallback.baseUrl };
}

export { COMMAND_CODE_MODEL_PREFIXES, inferKind, nativeSearchExclusions, resolveProviderId };
