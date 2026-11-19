import type { TopicDTO } from "../../shared/api";
import { randomId } from "../lib/crypto";

export interface TopicRef {
  id: string;
  key: string;
  name: string;
  muted: boolean;
}

interface TopicRow {
  id: string;
  key: string;
  name: string;
  muted: number;
  message_count: number;
  last_used_at: number;
}

export function normalizeTopic(input: string | null | undefined): { key: string; name: string } | null {
  const name = (input ?? "").replace(/\s+/g, " ").trim().slice(0, 64);
  if (!name) return null;
  const key = name.toLowerCase().replace(/^#+/, "");
  return key ? { key, name: name.replace(/^#+/, "") } : null;
}

export async function touchTopic(db: D1Database, userId: string, topic: { key: string; name: string }): Promise<TopicRef> {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO topics (id, user_id, key, name, muted, message_count, created_at, last_used_at)
       VALUES (?, ?, ?, ?, 0, 1, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET message_count = message_count + 1, last_used_at = excluded.last_used_at
       RETURNING id, key, name, muted`,
    )
    .bind(randomId("top"), userId, topic.key, topic.name, now, now)
    .first<{ id: string; key: string; name: string; muted: number }>();
  if (!row) throw new Error("Topic upsert returned no row");
  return { id: row.id, key: row.key, name: row.name, muted: row.muted === 1 };
}

function toTopicDTO(row: TopicRow): TopicDTO {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    muted: row.muted === 1,
    messageCount: row.message_count,
    lastUsedAt: row.last_used_at,
  };
}

export async function listTopics(db: D1Database, userId: string): Promise<TopicDTO[]> {
  const { results } = await db
    .prepare("SELECT * FROM topics WHERE user_id = ? ORDER BY last_used_at DESC LIMIT 200")
    .bind(userId)
    .all<TopicRow>();
  return results.map(toTopicDTO);
}

export async function setTopicMuted(db: D1Database, userId: string, id: string, muted: boolean): Promise<TopicDTO | null> {
  const row = await db
    .prepare("UPDATE topics SET muted = ? WHERE id = ? AND user_id = ? RETURNING *")
    .bind(muted ? 1 : 0, id, userId)
    .first<TopicRow>();
  return row ? toTopicDTO(row) : null;
}
