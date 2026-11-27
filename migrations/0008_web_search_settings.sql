-- Per-user web search routing configuration.
--
-- 'none' leaves the gateway untouched, 'native' forwards the client's own
-- provider search fields, and 'third_party' routes web searches through the
-- configured search API. An absent row means 'none', so the feature is inert
-- until a user opts in. The API key is AES-GCM ciphertext produced by
-- KeyCrypto; only its hint is ever read back into JSON.
CREATE TABLE IF NOT EXISTS user_web_search_settings (
  user_email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'none',
  provider TEXT,
  encrypted_api_key TEXT,
  key_hint TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
