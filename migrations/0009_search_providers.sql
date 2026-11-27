-- Third-party search providers become first-class, per-user entities with a
-- key pool, mirroring the model provider registry. Endpoints remain pinned by
-- kind in WebSearchClient; only credentials and health state live here.
--
-- The legacy settings row kept exactly one credential. Its ciphertext is
-- copied verbatim (same `web-search-keys` purpose and Secrets Store secret),
-- so existing configurations keep working without re-entering a key.
CREATE TABLE IF NOT EXISTS search_providers (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL REFERENCES users(email),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  UNIQUE (user_email, name)
);
CREATE INDEX IF NOT EXISTS idx_search_providers_user ON search_providers (lower(user_email));

CREATE TABLE IF NOT EXISTS search_provider_keys (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES search_providers(id) ON DELETE CASCADE,
  user_email TEXT NOT NULL REFERENCES users(email),
  name TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hint TEXT,
  request_limit INTEGER,
  used_requests INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  cooldown_until INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_search_provider_keys_provider ON search_provider_keys (provider_id);
CREATE INDEX IF NOT EXISTS idx_search_provider_keys_user ON search_provider_keys (lower(user_email));
CREATE INDEX IF NOT EXISTS idx_search_provider_keys_status ON search_provider_keys (status, priority);

INSERT INTO search_providers (id, user_email, kind, name, status, created_at, updated_at)
SELECT 'sp-' || lower(s.user_email) || '-' || lower(s.provider),
       lower(s.user_email),
       upper(s.provider),
       CASE WHEN upper(s.provider) = 'BRAVE' THEN 'Brave' ELSE 'Tavily' END,
       'active',
       s.created_at,
       s.updated_at
FROM user_web_search_settings s
WHERE upper(s.provider) IN ('BRAVE', 'TAVILY') AND s.encrypted_api_key IS NOT NULL;

INSERT INTO search_provider_keys (
  id, provider_id, user_email, name, encrypted_key, key_hint,
  request_limit, used_requests, reset_at, priority, status,
  cooldown_until, consecutive_failures, last_used_at, last_error, created_at, updated_at
)
SELECT 'spk-' || lower(s.user_email) || '-' || lower(s.provider),
       'sp-' || lower(s.user_email) || '-' || lower(s.provider),
       lower(s.user_email),
       'Imported key',
       s.encrypted_api_key,
       s.key_hint,
       NULL, 0, NULL, 0, 'active',
       NULL, 0, NULL, NULL, s.created_at, s.updated_at
FROM user_web_search_settings s
WHERE upper(s.provider) IN ('BRAVE', 'TAVILY') AND s.encrypted_api_key IS NOT NULL;

-- Rebuild the settings row: mode plus an optional selected provider. NULL
-- means "auto: all active search providers", and ON DELETE SET NULL keeps a
-- stale selection from breaking failover after a provider is deleted.
CREATE TABLE user_web_search_settings_v2 (
  user_email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'none',
  selected_provider_id TEXT REFERENCES search_providers(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO user_web_search_settings_v2 (user_email, mode, selected_provider_id, created_at, updated_at)
SELECT s.user_email,
       s.mode,
       CASE
         WHEN s.mode = 'third_party' AND upper(s.provider) IN ('BRAVE', 'TAVILY') AND s.encrypted_api_key IS NOT NULL
           THEN 'sp-' || lower(s.user_email) || '-' || lower(s.provider)
         ELSE NULL
       END,
       s.created_at,
       s.updated_at
FROM user_web_search_settings s;

DROP TABLE user_web_search_settings;
ALTER TABLE user_web_search_settings_v2 RENAME TO user_web_search_settings;
