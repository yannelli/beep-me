import type { DeliveryDTO, DeliveryStatus, MessageDTO, MessagePage, MessageSource, MessageStatus } from "../../shared/api";
import type { ChannelKind, ChannelTarget } from "../../shared/channels";
import { isPriority, type Priority } from "../../shared/priority";

export interface NewMessage {
  id: string;
  userId: string;
  agentId: string | null;
  agentName: string;
  priority: Priority;
  requestedPriority: Priority;
  topic: { key: string; name: string } | null;
  title: string | null;
  body: string;
  url: string | null;
  dedupeHash: string;
  status: MessageStatus | "pending";
  notes: string[];
  quiet: boolean;
  source: MessageSource;
  createdAt: number;
}

const MESSAGE_COLUMNS =
  "id, user_id, agent_id, agent_name, priority, requested_priority, topic_key, topic_name, title, body, url, dedupe_hash, status, notes, quiet, source, created_at";

function messageValues(m: NewMessage): unknown[] {
  return [
    m.id, m.userId, m.agentId, m.agentName, m.priority, m.requestedPriority, m.topic?.key ?? null, m.topic?.name ?? null,
    m.title, m.body, m.url, m.dedupeHash, m.status, JSON.stringify(m.notes), m.quiet ? 1 : 0, m.source, m.createdAt,
  ];
}

export async function insertMessage(db: D1Database, m: NewMessage): Promise<void> {
  await db.prepare(`INSERT INTO messages (${MESSAGE_COLUMNS}) VALUES (${"?, ".repeat(16)}?)`).bind(...messageValues(m)).run();
}

/** Inserts only while the agent sent fewer than `limit` counted messages since `since`. One statement, so parallel calls cannot both pass. */
export async function insertMessageUnderCap(db: D1Database, m: NewMessage, limit: number, since: number): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO messages (${MESSAGE_COLUMNS}) SELECT ${"?, ".repeat(16)}?
       WHERE (SELECT COUNT(*) FROM messages WHERE agent_id = ? AND created_at > ? AND status NOT IN ('throttled', 'muted', 'paused')) < ?
       RETURNING id`,
    )
    .bind(...messageValues(m), m.agentId, since, limit)
    .first<{ id: string }>();
  return row !== null;
}

export async function finishMessage(db: D1Database, id: string, status: MessageStatus, notes: string[], quiet: boolean): Promise<void> {
  await db.prepare("UPDATE messages SET status = ?, notes = ?, quiet = ? WHERE id = ?").bind(status, JSON.stringify(notes), quiet ? 1 : 0, id).run();
}

export async function findCollapseTarget(db: D1Database, userId: string, hash: string, since: number): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT id FROM messages WHERE user_id = ? AND dedupe_hash = ? AND created_at > ? AND status IN ('delivered', 'partial') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(userId, hash, since)
    .first<{ id: string }>();
  return row?.id ?? null;
}

export async function bumpRepeat(db: D1Database, id: string): Promise<number> {
  const row = await db
    .prepare("UPDATE messages SET repeat_count = repeat_count + 1, last_repeat_at = ? WHERE id = ? RETURNING repeat_count")
    .bind(Date.now(), id)
    .first<{ repeat_count: number }>();
  return row?.repeat_count ?? 1;
}

export async function countThrottled(db: D1Database, agentId: string, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE agent_id = ? AND status = 'throttled' AND created_at > ?")
    .bind(agentId, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface NewDelivery {
  id: string;
  messageId: string;
  userId: string;
  agentId: string | null;
  channelId: string;
  channelKind: ChannelKind;
  channelName: string;
  target: ChannelTarget;
  isSms: boolean;
  createdAt: number;
}

const DELIVERY_COLUMNS = "id, message_id, user_id, agent_id, channel_id, channel_kind, channel_name, target, is_sms, status, created_at, updated_at";

function deliveryValues(d: NewDelivery): unknown[] {
  return [d.id, d.messageId, d.userId, d.agentId, d.channelId, d.channelKind, d.channelName, d.target, d.isSms ? 1 : 0, "pending", d.createdAt, d.createdAt];
}

export async function insertDelivery(db: D1Database, d: NewDelivery): Promise<void> {
  await db.prepare(`INSERT INTO deliveries (${DELIVERY_COLUMNS}) VALUES (${"?, ".repeat(11)}?)`).bind(...deliveryValues(d)).run();
}

/** Reserves a text-message slot for the agent in one statement. Returns false when the hourly cap is used up. */
export async function reserveSmsDelivery(db: D1Database, d: NewDelivery, limit: number, since: number): Promise<boolean> {
  if (!d.agentId) {
    await insertDelivery(db, d);
    return true;
  }
  const row = await db
    .prepare(
      `INSERT INTO deliveries (${DELIVERY_COLUMNS}) SELECT ${"?, ".repeat(11)}?
       WHERE (SELECT COUNT(*) FROM deliveries WHERE agent_id = ? AND is_sms = 1 AND created_at > ?) < ?
       RETURNING id`,
    )
    .bind(...deliveryValues(d), d.agentId, since, limit)
    .first<{ id: string }>();
  return row !== null;
}

export async function finishDelivery(db: D1Database, id: string, status: DeliveryStatus, providerId: string | null, detail: string | null): Promise<void> {
  await db
    .prepare("UPDATE deliveries SET status = ?, provider_id = ?, detail = ?, updated_at = ? WHERE id = ?")
    .bind(status, providerId, detail?.slice(0, 500) ?? null, Date.now(), id)
    .run();
}

export async function updateDeliveryStatus(db: D1Database, id: string, status: DeliveryStatus, detail: string | null): Promise<void> {
  await db
    .prepare("UPDATE deliveries SET status = ?, detail = COALESCE(?, detail), updated_at = ? WHERE id = ? AND status != 'delivered'")
    .bind(status, detail, Date.now(), id)
    .run();
}

interface DeliveryRow {
  id: string;
  message_id: string;
  channel_id: string;
  channel_kind: ChannelKind;
  channel_name: string;
  target: ChannelTarget;
  status: DeliveryStatus;
  provider_id: string | null;
  detail: string | null;
  updated_at: number;
}

export async function deliveriesFor(db: D1Database, messageIds: string[]): Promise<DeliveryRow[]> {
  if (!messageIds.length) return [];
  const { results } = await db
    .prepare(`SELECT * FROM deliveries WHERE message_id IN (${messageIds.map(() => "?").join(", ")}) ORDER BY created_at`)
    .bind(...messageIds)
    .all<DeliveryRow>();
  return results;
}

function toDeliveryDTO(row: DeliveryRow): DeliveryDTO {
  return {
    id: row.id,
    channelId: row.channel_id,
    channelKind: row.channel_kind,
    channelName: row.channel_name,
    target: row.target,
    status: row.status,
    detail: row.detail,
    updatedAt: row.updated_at,
  };
}

interface MessageRow {
  id: string;
  agent_id: string | null;
  agent_name: string;
  priority: string;
  requested_priority: string;
  topic_key: string | null;
  topic_name: string | null;
  title: string | null;
  body: string;
  url: string | null;
  status: string;
  repeat_count: number;
  last_repeat_at: number | null;
  notes: string;
  quiet: number;
  source: MessageSource;
  created_at: number;
}

const FINAL_STATUSES = new Set(["delivered", "partial", "failed", "muted", "throttled", "paused"]);

function toMessageDTO(row: MessageRow, deliveries: DeliveryRow[]): MessageDTO {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentName: row.agent_name,
    priority: isPriority(row.priority) ? row.priority : "medium",
    requestedPriority: isPriority(row.requested_priority) ? row.requested_priority : "medium",
    topic: row.topic_key ? { key: row.topic_key, name: row.topic_name ?? row.topic_key } : null,
    title: row.title,
    body: row.body,
    url: row.url,
    status: (FINAL_STATUSES.has(row.status) ? row.status : "partial") as MessageStatus,
    repeatCount: row.repeat_count,
    lastRepeatAt: row.last_repeat_at,
    notes: JSON.parse(row.notes) as string[],
    quiet: row.quiet === 1,
    source: row.source,
    createdAt: row.created_at,
    deliveries: deliveries.filter((d) => d.message_id === row.id).map(toDeliveryDTO),
  };
}

export interface MessageFilters {
  before?: number;
  agentId?: string;
  status?: string;
  priority?: string;
  topic?: string;
  limit?: number;
}

export async function listMessages(db: D1Database, userId: string, filters: MessageFilters): Promise<MessagePage> {
  const limit = Math.min(Math.max(filters.limit ?? 30, 1), 50);
  const where = ["user_id = ?"];
  const values: unknown[] = [userId];
  const add = (clause: string, value: unknown) => {
    where.push(clause);
    values.push(value);
  };
  if (filters.before) add("created_at < ?", filters.before);
  if (filters.agentId) add("agent_id = ?", filters.agentId);
  if (filters.status) add("status = ?", filters.status);
  if (filters.priority) add("priority = ?", filters.priority);
  if (filters.topic) add("topic_key = ?", filters.topic.toLowerCase());
  const { results } = await db
    .prepare(`SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values, limit + 1)
    .all<MessageRow>();
  const page = results.slice(0, limit);
  const deliveries = await deliveriesFor(db, page.map((row) => row.id));
  const last = page.at(-1);
  return { items: page.map((row) => toMessageDTO(row, deliveries)), nextBefore: results.length > limit && last ? last.created_at : null };
}

export async function getMessage(db: D1Database, userId: string, id: string): Promise<MessageDTO | null> {
  const row = await db.prepare("SELECT * FROM messages WHERE id = ? AND user_id = ?").bind(id, userId).first<MessageRow>();
  return row ? toMessageDTO(row, await deliveriesFor(db, [id])) : null;
}

export async function pruneMessages(db: D1Database, olderThan: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM deliveries WHERE created_at < ?").bind(olderThan),
    db.prepare("DELETE FROM messages WHERE created_at < ?").bind(olderThan),
    db.prepare("DELETE FROM link_codes WHERE expires_at < ?").bind(Date.now()),
  ]);
}
