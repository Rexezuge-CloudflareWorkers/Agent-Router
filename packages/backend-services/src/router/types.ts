import type { ProviderDAO, ProviderKeyDAO, UsageLedgerDAO } from '@agent-router/backend-data/dao';
import type { D1Queryable } from '@rexezuge/d1';
import type { ProviderKind } from '@agent-router/shared';
import type { AppConfiguration } from '@agent-router/backend-runtime/config';
import type { CommandCodeEndpoint, CommandCodeService } from '../commandcode';

interface RouterServiceEnv {
  DB: D1Queryable;
  PROXY_TIMEOUT_MS?: string;
  PROXY_MAX_ATTEMPTS?: string;
  PROXY_MAX_BODY_BYTES?: string;
  KEY_COOLDOWN_BASE_MS?: string;
  KEY_MAX_CONSECUTIVE_FAILURES?: string;
  PROVIDER_KEYS_ENCRYPTION_SECRET?: { get(): Promise<string> };
}

interface RouterServiceDeps {
  providerDAO?: () => Promise<ProviderDAO>;
  providerKeyDAO?: () => Promise<ProviderKeyDAO>;
  usageDAO?: () => Promise<UsageLedgerDAO>;
  masterKey?: () => Promise<string>;
  config?: AppConfiguration;
  fetchImpl?: typeof fetch;
  codexTokens?: CodexAccessResolver;
  commandCode?: CommandCodeService;
}

/**
Minimal structural surface of CodexTokenService so the router stays
decoupled (type-only; the concrete service is wired in requestScope).
*/
interface CodexAccessResolver {
  getAccessToken(
    providerId: string,
    keyId: string,
    userEmail: string,
    opts?: { forceRefresh?: boolean },
  ): Promise<{ accessToken: string; accountId: string | null }>;
}

interface ProxyRequest {
  userEmail: string;
  gatewayKeyId: string | null;
  providerId: string;
  providerKind: ProviderKind;
  providerBaseUrl: string | null;
  upstreamPath: string;
  upstreamBody: unknown;
  upstreamModel: string | null;
  bodyBytes: number;
  /**
  The request body exactly as the client sent it. Reused for providers that
  do not rewrite the payload so it is serialized once instead of twice.
  */
  rawBodyText?: string;
  /**
  Client-facing endpoint; Command Code collapses all of them to /alpha/generate.
  */
  clientEndpoint?: CommandCodeEndpoint;
  clientStream?: boolean;
  incomingHeaders?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

interface ProxySuccess {
  status: number;
  bodyText?: string;
  bodyStream?: ReadableStream<Uint8Array>;
  contentType: string | null;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
  providerKeyId: string;
  attempts: number;
}

/**
Health knobs and the request row shared by every attempt.
*/
interface AttemptContext {
  keyDAO: ProviderKeyDAO;
  usageDAO: UsageLedgerDAO;
  masterKey: string;
  timeoutMs: number;
  cooldownBase: number;
  disableAfter: number;
}

type AttemptOutcome =
  { kind: 'success'; success: ProxySuccess } | { kind: 'failed'; status: number; message: string; accountRouted: boolean };

export type { AttemptContext, AttemptOutcome, CodexAccessResolver, ProxyRequest, ProxySuccess, RouterServiceDeps, RouterServiceEnv };
