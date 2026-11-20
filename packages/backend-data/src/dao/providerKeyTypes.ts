import type { CodexOAuthStatus, ProviderKeyAuthType, ProviderKeyMetadata, ProviderKeyStatus } from '@agent-router/shared';

/**
Raw `provider_keys` row plus its mapping to the public metadata shape.

Lives beside `ProviderKeyDAO` rather than inside it so the DAO file stays
within the god-file budget; nothing here touches the database.
*/
interface ProviderKeyRow {
  id: string;
  provider_id: string;
  user_email: string;
  name: string;
  encrypted_key: string;
  key_hint: string | null;
  token_limit: number | null;
  request_limit: number | null;
  used_tokens: number;
  used_requests: number;
  reset_at: number | null;
  priority: number;
  status: string;
  cooldown_until: number | null;
  consecutive_failures: number;
  last_used_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number | null;
  auth_type?: string | null;
  encrypted_access_token?: string | null;
  encrypted_refresh_token?: string | null;
  codex_account_id?: string | null;
  access_expires_at?: number | null;
  oauth_status?: string | null;
}

function toAuthType(value: unknown): ProviderKeyAuthType {
  return value === 'codex_oauth' ? 'codex_oauth' : 'static';
}

function toOAuthStatus(value: unknown): CodexOAuthStatus | null {
  const allowed: readonly string[] = ['pending', 'connected', 'expired', 'revoked'];
  return typeof value === 'string' && allowed.includes(value) ? (value as CodexOAuthStatus) : null;
}

function toMetadata(row: ProviderKeyRow): ProviderKeyMetadata {
  return {
    id: row.id,
    providerId: row.provider_id,
    userEmail: row.user_email,
    name: row.name,
    keyHint: row.key_hint,
    tokenLimit: row.token_limit,
    requestLimit: row.request_limit,
    usedTokens: row.used_tokens,
    usedRequests: row.used_requests,
    resetAt: row.reset_at,
    priority: row.priority,
    status: row.status as ProviderKeyStatus,
    cooldownUntil: row.cooldown_until,
    consecutiveFailures: row.consecutive_failures,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authType: toAuthType(row.auth_type),
    oauthStatus: toOAuthStatus(row.oauth_status),
    codexAccountId: row.codex_account_id ?? null,
    accessExpiresAt: row.access_expires_at ?? null,
  };
}

export { toAuthType, toMetadata, toOAuthStatus };
export type { ProviderKeyRow };
