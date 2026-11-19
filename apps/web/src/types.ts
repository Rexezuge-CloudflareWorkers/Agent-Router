export interface CurrentUser {
  email: string;
  username?: string | null;
  preferredLanguage?: string | null;
}

export type ProviderKind = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OPENAI_COMPAT' | 'OPENAI_CODEX' | 'COMMAND_CODE';

export type ProviderKeyAuthType = 'static' | 'codex_oauth';

export type CodexOAuthStatus = 'pending' | 'connected' | 'expired' | 'revoked';

export interface Provider {
  id: string;
  userEmail: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string | null;
  status: 'active' | 'disabled';
  createdAt: number;
  updatedAt: number | null;
}

export interface ProviderKey {
  id: string;
  providerId: string;
  userEmail: string;
  name: string;
  keyHint: string | null;
  tokenLimit: number | null;
  requestLimit: number | null;
  usedTokens: number;
  usedRequests: number;
  resetAt: number | null;
  priority: number;
  status: 'active' | 'degraded' | 'cooling' | 'exhausted' | 'disabled';
  cooldownUntil: number | null;
  consecutiveFailures: number;
  lastUsedAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number | null;
  authType: ProviderKeyAuthType;
  oauthStatus: CodexOAuthStatus | null;
  codexAccountId: string | null;
  accessExpiresAt: number | null;
}

export interface GatewayKey {
  keyId: string;
  userEmail: string;
  keyPrefix: string;
  name: string;
  status: 'active' | 'revoked';
  expiresAt: number;
  lastUsedAt: number | null;
  createdAt: number;
}

export interface CreatedGatewayKey {
  keyId: string;
  key: string;
  name: string;
  expiresAt: number;
  prefix: string;
}

export interface UsageEntry {
  id: string;
  userEmail: string;
  gatewayKeyId: string | null;
  providerId: string | null;
  providerKeyId: string | null;
  upstreamModel: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number | null;
  statusCode: number;
  errorCode: string | null;
  estimated: boolean;
  createdAt: number;
}

export interface UsageSummary {
  totalTokens: number;
  totalRequests: number;
  promptTokens: number;
  completionTokens: number;
  byProvider: Array<{ providerId: string; totalTokens: number; totalRequests: number }>;
}
