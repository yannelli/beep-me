-- Fallback steps, delivery reasons, and how each answer was matched. Applied once, at schema version 3.
ALTER TABLE deliveries ADD COLUMN reason TEXT;
ALTER TABLE interactions ADD COLUMN matched_by TEXT;

CREATE TABLE IF NOT EXISTS fallbacks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  trigger_kind TEXT NOT NULL,
  after_minutes INTEGER NOT NULL,
  destinations TEXT NOT NULL,
  priority TEXT,
  source TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  detail TEXT,
  channel_names TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  fired_at INTEGER
);
CREATE INDEX IF NOT EXISTS fallbacks_due ON fallbacks(status, due_at);
CREATE INDEX IF NOT EXISTS fallbacks_message ON fallbacks(message_id);
