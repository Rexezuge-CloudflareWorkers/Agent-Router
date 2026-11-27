import type { SearchProviderKeyMetadata, SearchProviderKeyStatus } from '@agent-router/shared';

/**
Raw `search_provider_keys` row plus its mapping to the public metadata
shape. Kept beside the DAO so the database file stays within its budget.
*/
interface SearchProviderKeyRow {
  id: string;
  provider_id: string;
  user_email: string;
  name: string;
  encrypted_key: string;
  key_hint: string | null;
  request_limit: number | null;
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
}

interface SearchSelectableKeyRow extends SearchProviderKeyRow {
  provider_kind: string;
}

function toMetadata(row: SearchProviderKeyRow): SearchProviderKeyMetadata {
  return {
    id: row.id,
    providerId: row.provider_id,
    userEmail: row.user_email,
    name: row.name,
    keyHint: row.key_hint,
    requestLimit: row.request_limit,
    usedRequests: row.used_requests,
    resetAt: row.reset_at,
    priority: row.priority,
    status: row.status as SearchProviderKeyStatus,
    cooldownUntil: row.cooldown_until,
    consecutiveFailures: row.consecutive_failures,
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { toMetadata };
export type { SearchProviderKeyRow, SearchSelectableKeyRow };
