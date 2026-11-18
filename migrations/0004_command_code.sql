-- Agent-Router 0004: Command Code provider state.
-- Device fingerprints are derived deterministically from the provider key, so
-- only the 8h fingerprint/lifecycle pre-request throttle needs persistence.
-- `next_init_at` = 0 means "never initialized"; failed pre-requests leave it
-- untouched so the next proxied request retries.
CREATE TABLE IF NOT EXISTS command_code_key_state (
  provider_key_id TEXT PRIMARY KEY REFERENCES provider_keys(id) ON DELETE CASCADE,
  next_init_at INTEGER NOT NULL DEFAULT 0,
  fingerprint_recorded_at INTEGER,
  lifecycle_sent_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cc_key_state_next ON command_code_key_state (next_init_at);
