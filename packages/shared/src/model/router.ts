export type ProviderKind = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OPENAI_COMPAT' | 'OPENAI_CODEX' | 'COMMAND_CODE';

export type ProviderStatus = 'active' | 'disabled';

export type ProviderKeyStatus = 'active' | 'cooling' | 'exhausted' | 'disabled';

export type ProviderKeyAuthType = 'static' | 'codex_oauth';

export type CodexOAuthStatus = 'pending' | 'connected' | 'expired' | 'revoked';

export interface ProviderMetadata {
  id: string;
  userEmail: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string | null;
  status: ProviderStatus;
  createdAt: number;
  updatedAt: number | null;
}

export interface ProviderKeyMetadata {
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
  status: ProviderKeyStatus;
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

export interface GatewayKeyMetadata {
  keyId: string;
  userEmail: string;
  keyPrefix: string;
  name: string;
  status: 'active' | 'revoked';
  expiresAt: number;
  lastUsedAt: number | null;
  createdAt: number;
}

export interface UsageLedgerMetadata {
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

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'OPENAI',
  'ANTHROPIC',
  'GEMINI',
  'OPENAI_COMPAT',
  'OPENAI_CODEX',
  'COMMAND_CODE',
];

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === 'string' && (PROVIDER_KINDS as readonly string[]).includes(value);
}
