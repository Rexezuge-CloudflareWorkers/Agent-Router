-- Per-user peak-hours routing preference.
--
-- A user picks what the gateway does when they call a model that is inside its
-- peak window: continue routing, rewrite the model to a chosen fallback, or
-- reject with 429. An absent row means 'continue', so the feature is inert
-- until a user opts in.
CREATE TABLE IF NOT EXISTS user_peak_preferences (
  user_email TEXT PRIMARY KEY REFERENCES users(email) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'continue',
  fallback_model TEXT,
  updated_at INTEGER NOT NULL
);
