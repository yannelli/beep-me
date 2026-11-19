import type { InteractionDTO, InteractionKind } from "../../shared/api";
import type { ChannelKind } from "../../shared/channels";
import type { InboundMedia } from "../channels/types";
import { randomId } from "../lib/crypto";

export interface NewInteraction {
  userId: string;
  channelId: string;
  channelKind: ChannelKind;
  /** The notification this answers. null when Beep Me cannot match it; the dashboard still shows it. */
  messageId: string | null;
  kind: InteractionKind;
  text: string | null;
  optionIndex: number | null;
  media: InboundMedia[];
  sender: string | null;
  /** Provider id of the inbound event. A repeat of the same ref is ignored, so webhook retries are safe. */
  providerRef: string | null;
}

export interface InteractionRow {
  id: string;
  user_id: string;
  message_id: string | null;
  agent_id: string | null;
  channel_id: string;
  channel_kind: ChannelKind;
  kind: InteractionKind;
  text: string | null;
  option_index: number | null;
  media: string;
  sender: string | null;
  provider_ref: string | null;
  created_at: number;
  read_at: number | null;
  message_options?: string | null;
}

/** Stores an inbound reply, choice, reaction, or vote. The owning agent comes from the matched message. */
export async function recordInteraction(db: D1Database, input: NewInteraction): Promise<{ id: string; agentId: string | null } | null> {
  const row = await db
    .prepare(
      `INSERT INTO interactions (id, user_id, message_id, agent_id, channel_id, channel_kind, kind, text, option_index, media, sender, provider_ref, created_at)
       VALUES (?, ?, ?, (SELECT agent_id FROM messages WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel_id, provider_ref) DO NOTHING
       RETURNING id, agent_id`,
    )
    .bind(
      randomId("int"),
      input.userId,
      input.messageId,
      input.messageId,
      input.channelId,
      input.channelKind,
      input.kind,
      input.text?.slice(0, 8000) ?? null,
      input.optionIndex,
      JSON.stringify(input.media),
      input.sender?.slice(0, 200) ?? null,
      input.providerRef,
      Date.now(),
    )
    .first<{ id: string; agent_id: string | null }>();
  return row ? { id: row.id, agentId: row.agent_id } : null;
}

export interface MatchedMessage {
  messageId: string;
  agentId: string | null;
  options: string[];
}

/** Finds the notification a provider message belongs to, from the provider id stored on its delivery. */
export async function findMessageByProviderId(db: D1Database, channelId: string, providerId: string): Promise<MatchedMessage | null> {
  const row = await db
    .prepare(
      `SELECT m.id, m.agent_id, m.options FROM deliveries d JOIN messages m ON m.id = d.message_id
       WHERE d.channel_id = ? AND d.provider_id = ? LIMIT 1`,
    )
    .bind(channelId, providerId)
    .first<{ id: string; agent_id: string | null; options: string }>();
  return row ? { messageId: row.id, agentId: row.agent_id, options: JSON.parse(row.options) as string[] } : null;
}

/** The newest message sent on a channel since `since`. With preferAwaiting, messages that asked for a reply win. */
export async function latestMessageForChannel(
  db: D1Database,
  channelId: string,
  options: { since: number; target?: "main" | "topic"; preferAwaiting?: boolean },
): Promise<MatchedMessage | null> {
  const awaiting = options.preferAwaiting ? "(m.expect_reply = 1 OR m.options != '[]') DESC," : "";
  const row = await db
    .prepare(
      `SELECT m.id, m.agent_id, m.options FROM deliveries d JOIN messages m ON m.id = d.message_id
       WHERE d.channel_id = ? AND d.created_at > ? AND d.status IN ('sent', 'delivered') ${options.target ? "AND d.target = ?" : ""}
       ORDER BY ${awaiting} d.created_at DESC LIMIT 1`,
    )
    .bind(...[channelId, options.since, ...(options.target ? [options.target] : [])])
    .first<{ id: string; agent_id: string | null; options: string }>();
  return row ? { messageId: row.id, agentId: row.agent_id, options: JSON.parse(row.options) as string[] } : null;
}

export interface InteractionQuery {
  messageId?: string;
  since?: number;
  unreadOnly: boolean;
  limit: number;
}

export async function listInteractionsForAgent(db: D1Database, agentId: string, query: InteractionQuery): Promise<InteractionRow[]> {
  const where = ["i.agent_id = ?"];
  const values: unknown[] = [agentId];
  if (query.messageId) {
    where.push("i.message_id = ?");
    values.push(query.messageId);
  }
  if (query.since) {
    where.push("i.created_at > ?");
    values.push(query.since);
  }
  if (query.unreadOnly) where.push("i.read_at IS NULL");
  const { results } = await db
    .prepare(
      `SELECT i.*, m.options AS message_options FROM interactions i LEFT JOIN messages m ON m.id = i.message_id
       WHERE ${where.join(" AND ")} ORDER BY i.created_at ASC LIMIT ?`,
    )
    .bind(...values, query.limit)
    .all<InteractionRow>();
  return results;
}

export async function markInteractionsRead(db: D1Database, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await db
    .prepare(`UPDATE interactions SET read_at = ? WHERE read_at IS NULL AND id IN (${ids.map(() => "?").join(", ")})`)
    .bind(Date.now(), ...ids)
    .run();
}

export async function getInteraction(db: D1Database, id: string): Promise<InteractionRow | null> {
  return db.prepare("SELECT * FROM interactions WHERE id = ?").bind(id).first<InteractionRow>();
}

export async function interactionsFor(db: D1Database, messageIds: string[]): Promise<InteractionRow[]> {
  if (!messageIds.length) return [];
  const { results } = await db
    .prepare(
      `SELECT i.*, m.options AS message_options FROM interactions i LEFT JOIN messages m ON m.id = i.message_id
       WHERE i.message_id IN (${messageIds.map(() => "?").join(", ")}) ORDER BY i.created_at ASC`,
    )
    .bind(...messageIds)
    .all<InteractionRow>();
  return results;
}

/** Media links point at the dashboard proxy by default. Agents get `${origin}/v1/media`, which takes their token. */
export function toInteractionDTO(row: InteractionRow, mediaBase = "/api/media"): InteractionDTO {
  const options = row.message_options ? (JSON.parse(row.message_options) as string[]) : [];
  const media = JSON.parse(row.media) as InboundMedia[];
  return {
    id: row.id,
    messageId: row.message_id,
    agentId: row.agent_id,
    channelId: row.channel_id,
    channelKind: row.channel_kind,
    kind: row.kind,
    text: row.text,
    option: row.option_index === null ? null : { index: row.option_index, label: options[row.option_index] ?? `Option ${row.option_index + 1}` },
    media: media.map((item, index) => ({ kind: item.kind, name: item.name, mime: item.mime, size: item.size, url: `${mediaBase}/${row.id}/${index}` })),
    sender: row.sender,
    createdAt: row.created_at,
    readAt: row.read_at,
  };
}
