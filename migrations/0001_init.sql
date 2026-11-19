-- Beep Me schema. Every statement is idempotent: the Worker also applies this file at startup.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar_url TEXT,
  google_sub TEXT UNIQUE,
  settings TEXT NOT NULL,
  session_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  config_enc TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready',
  status_detail TEXT,
  last_used_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS channels_user ON channels(user_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  client_id TEXT,
  client_name TEXT,
  token_hash TEXT UNIQUE,
  token_hint TEXT,
  max_priority TEXT NOT NULL DEFAULT 'urgent',
  channel_ids TEXT,
  sms_per_hour INTEGER,
  messages_per_hour INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  muted_until INTEGER,
  last_seen_at INTEGER,
  last_user_agent TEXT,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS agents_user ON agents(user_id);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  muted INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  UNIQUE (user_id, key)
);

CREATE TABLE IF NOT EXISTS topic_threads (
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  topic_key TEXT NOT NULL,
  thread_ref TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (channel_id, topic_key)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_id TEXT,
  agent_name TEXT NOT NULL,
  priority TEXT NOT NULL,
  requested_priority TEXT NOT NULL,
  topic_key TEXT,
  topic_name TEXT,
  title TEXT,
  body TEXT NOT NULL,
  url TEXT,
  dedupe_hash TEXT NOT NULL,
  repeat_count INTEGER NOT NULL DEFAULT 1,
  last_repeat_at INTEGER,
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '[]',
  quiet INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_user_time ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS messages_agent_time ON messages(agent_id, created_at);
CREATE INDEX IF NOT EXISTS messages_dedupe ON messages(user_id, dedupe_hash, created_at);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  agent_id TEXT,
  channel_id TEXT NOT NULL,
  channel_kind TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  target TEXT NOT NULL,
  is_sms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  provider_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS deliveries_message ON deliveries(message_id);
CREATE INDEX IF NOT EXISTS deliveries_sms ON deliveries(agent_id, is_sms, created_at);

CREATE TABLE IF NOT EXISTS link_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
