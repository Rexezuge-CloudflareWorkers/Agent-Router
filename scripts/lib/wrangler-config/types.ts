import path from 'node:path';

export const CONFIG_PATH = path.join(process.cwd(), 'wrangler.jsonc');
export const TEMPLATE_PATH = path.join(process.cwd(), 'apps/api/wrangler.template.jsonc');
export const DEFAULT_UUID = '00000000-0000-0000-0000-000000000000';
export const DEFAULT_HEX_ID = '00000000000000000000000000000000';
export const DEFAULT_SECRET_STORE_NAME = 'default';
export const DEFAULT_KV_NAMESPACE_NAMES: Record<string, string> = {
  OAUTH2_TOKEN_CACHE: 'agent-router-oauth2-token-cache',
};
export const VECTORIZE_DIMENSIONS = 1024;

export interface WranglerConfig {
  name?: string;
  vars?: Record<string, unknown>;
  d1_databases?: Array<{
    binding?: string;
    database_id?: string;
    database_name?: string;
  }>;
  kv_namespaces?: Array<{
    binding?: string;
    id?: string;
  }>;
  secrets_store_secrets?: Array<{
    binding?: string;
    store_id?: string;
    secret_name?: string;
  }>;
  queues?: {
    producers?: Array<{ binding: string; queue: string }>;
    consumers?: Array<{ queue: string }>;
  };
  vectorize?: Array<{
    binding: string;
    index_name: string;
  }>;
}

export interface D1Database {
  name?: string;
  uuid?: string;
  id?: string;
  database_id?: string;
}

export interface KVNamespace {
  title?: string;
  name?: string;
  id?: string;
}

export interface SecretStore {
  name: string;
  id: string;
}
