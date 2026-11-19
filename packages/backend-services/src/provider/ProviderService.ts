import { ProviderDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import { BadRequestError, NotFoundError } from '@rexezuge/errors';
import { isProviderKind } from '@agent-router/shared';
import type { ProviderKind, ProviderMetadata } from '@agent-router/shared';
import { TimestampUtil, UUIDUtil } from '@rexezuge/shared';
import { AppConfiguration } from '@agent-router/backend-runtime/config';

interface ProviderServiceEnv {
  DB: D1Queryable;
  MAX_PROVIDERS_PER_USER?: string;
}

interface ProviderServiceDeps {
  providerDAO?: () => Promise<ProviderDAO>;
  config?: AppConfiguration;
}

const DEFAULT_BASE_URLS: Record<ProviderKind, string | null> = {
  OPENAI: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com',
  GEMINI: 'https://generativelanguage.googleapis.com',
  OPENAI_COMPAT: null,
  // ChatGPT subscription (Codex OAuth) tokens are honored by the Codex
  // backend, not the OpenAI platform API.
  OPENAI_CODEX: 'https://chatgpt.com/backend-api/codex',
  // Command Code's CLI API (OpenAI/Anthropic-compatible through this router).
  COMMAND_CODE: 'https://api.commandcode.ai',
};

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
const PRIVATE_SUFFIXES: readonly string[] = ['.local', '.internal'];

function normalizeBaseUrl(kind: ProviderKind, raw: unknown): string | null {
  if (raw == null || raw === '') return DEFAULT_BASE_URLS[kind];
  if (typeof raw !== 'string') throw new BadRequestError('baseUrl must be a string');
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_BASE_URLS[kind];
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestError('baseUrl must be a valid http(s) URL');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new BadRequestError('baseUrl must be http(s)');
  if (url.username || url.password) throw new BadRequestError('baseUrl must not contain credentials');
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOSTS.has(host) || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new BadRequestError('baseUrl must not target private hosts');
  }
  if (kind !== 'OPENAI_COMPAT' && trimmed !== DEFAULT_BASE_URLS[kind]) {
    throw new BadRequestError(`baseUrl for ${kind} must be the default endpoint`);
  }
  return trimmed.replace(/\/$/, '');
}

class ProviderService {
  private readonly deps: Required<ProviderServiceDeps>;

  constructor(
    private readonly env: ProviderServiceEnv,
    deps: ProviderServiceDeps = {},
  ) {
    const config = deps.config ?? AppConfiguration.fromEnv(env);
    this.deps = {
      providerDAO: () => Promise.resolve(new ProviderDAO(env.DB)),
      config,
      ...deps,
    };
  }

  public async createProvider(userEmail: string, kind: unknown, name: unknown, baseUrl?: unknown): Promise<ProviderMetadata> {
    if (!isProviderKind(kind)) {
      throw new BadRequestError('kind must be one of OPENAI, ANTHROPIC, GEMINI, OPENAI_COMPAT, OPENAI_CODEX, COMMAND_CODE');
    }
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) throw new BadRequestError('name is required');
    if (trimmed.length > 80) throw new BadRequestError('name must be at most 80 characters');
    const normalized = userEmail.toLowerCase();
    const max = this.deps.config.getMaxProvidersPerUser();
    const dao = await this.deps.providerDAO();
    const count = await dao.countByUser(normalized);
    if (count >= max) throw new BadRequestError(`Maximum ${max} providers allowed`);
    const existing = await dao.listByUser(normalized);
    if (existing.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) throw new BadRequestError('Provider name is already taken');
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    const row = { id: UUIDUtil.getRandomUUID(), userEmail: normalized, kind, name: trimmed, baseUrl: normalizeBaseUrl(kind, baseUrl), now };
    await dao.create(row);
    const created = await dao.getById(row.id);
    if (!created) throw new NotFoundError('Provider not found');
    return created;
  }

  public async listProviders(userEmail: string): Promise<ProviderMetadata[]> {
    const dao = await this.deps.providerDAO();
    return dao.listByUser(userEmail.toLowerCase());
  }

  public async getProvider(id: string, userEmail: string): Promise<ProviderMetadata> {
    const dao = await this.deps.providerDAO();
    const row = await dao.getById(id);
    if (!row || row.userEmail.toLowerCase() !== userEmail.toLowerCase()) throw new NotFoundError('Provider not found');
    return row;
  }

  public async updateProvider(
    id: string,
    userEmail: string,
    patch: { name?: unknown; baseUrl?: unknown; status?: unknown },
  ): Promise<ProviderMetadata> {
    const current = await this.getProvider(id, userEmail);
    const dao = await this.deps.providerDAO();
    let name = current.name;
    if (patch.name !== undefined) {
      const trimmed = typeof patch.name === 'string' ? patch.name.trim() : '';
      if (!trimmed) throw new BadRequestError('name is required');
      if (trimmed.length > 80) throw new BadRequestError('name must be at most 80 characters');
      const siblings = await dao.listByUser(userEmail.toLowerCase());
      if (siblings.some((p) => p.id !== id && p.name.toLowerCase() === trimmed.toLowerCase()))
        throw new BadRequestError('Provider name is already taken');
      name = trimmed;
    }
    const baseUrl = patch.baseUrl === undefined ? current.baseUrl : normalizeBaseUrl(current.kind, patch.baseUrl);
    let status = current.status;
    if (patch.status !== undefined) {
      if (patch.status !== 'active' && patch.status !== 'disabled') throw new BadRequestError('status must be active or disabled');
      status = patch.status;
    }
    const now = TimestampUtil.getCurrentUnixTimestampInSeconds();
    await dao.update(id, userEmail.toLowerCase(), { name, baseUrl, status, now });
    const updated = await dao.getById(id);
    if (!updated) throw new NotFoundError('Provider not found');
    return updated;
  }

  public async deleteProvider(id: string, userEmail: string): Promise<void> {
    await this.getProvider(id, userEmail);
    const dao = await this.deps.providerDAO();
    await dao.delete(id, userEmail.toLowerCase());
  }
}

export { ProviderService };
export type { ProviderServiceDeps, ProviderServiceEnv };
