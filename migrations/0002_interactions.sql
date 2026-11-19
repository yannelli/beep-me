-- Replies, button choices, reactions, and inbound media. Applied once, at schema version 2.
ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN options TEXT NOT NULL DEFAULT '[]';
ALTER TABLE messages ADD COLUMN expect_reply INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN sender_name TEXT;

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  agent_id TEXT,
  channel_id TEXT NOT NULL,
  channel_kind TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  option_index INTEGER,
  media TEXT NOT NULL DEFAULT '[]',
  sender TEXT,
  provider_ref TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS interactions_agent ON interactions(agent_id, created_at);
CREATE INDEX IF NOT EXISTS interactions_message ON interactions(message_id);
CREATE INDEX IF NOT EXISTS interactions_user ON interactions(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS interactions_provider_ref ON interactions(channel_id, provider_ref);
CREATE INDEX IF NOT EXISTS deliveries_provider ON deliveries(channel_id, provider_id);
