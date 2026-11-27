-- Per-gateway-key peak-hours routing preference.
--
-- Each gateway key picks what the gateway does when a client calls a model
-- inside its peak window: continue routing, rewrite the model to a chosen
-- fallback, or reject with 429. An absent row means 'continue'. The setting
-- belongs to the key, so two keys owned by the same user may behave differently.
CREATE TABLE IF NOT EXISTS gateway_key_peak_preferences (
  key_id TEXT PRIMARY KEY REFERENCES gateway_keys(key_id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'continue',
  fallback_model TEXT,
  updated_at INTEGER NOT NULL
);

-- Preserve existing behavior: carry each user's former preference onto all of
-- their keys. Keys without a former user preference stay on the default.
INSERT INTO gateway_key_peak_preferences (key_id, mode, fallback_model, updated_at)
SELECT gk.key_id, upp.mode, upp.fallback_model, upp.updated_at
FROM gateway_keys gk
JOIN user_peak_preferences upp ON lower(gk.user_email) = lower(upp.user_email)
ON CONFLICT(key_id) DO NOTHING;
