import type { FallbackDTO, FallbackStatus } from "../../shared/api";
import { isPriority, type Priority } from "../../shared/priority";
import type { Destination, FallbackTrigger } from "../../shared/settings";
import { randomId } from "../lib/crypto";

export interface NewFallback {
  userId: string;
  messageId: string;
  when: FallbackTrigger;
  afterMinutes: number;
  destinations: Destination[];
  priority: Priority | null;
  source: FallbackDTO["source"];
  /** Origin of the request that sent the message. The cron has no request, so links use this one. */
  origin: string;
  channelNames: string[];
  createdAt: number;
}

export interface FallbackRow {
  id: string;
  user_id: string;
  message_id: string;
  trigger_kind: FallbackTrigger;
  after_minutes: number;
  destinations: string;
  priority: string | null;
  source: FallbackDTO["source"];
  origin: string;
  status: FallbackStatus;
  due_at: number;
  detail: string | null;
  channel_names: string;
  created_at: number;
  fired_at: number | null;
}

export async function insertFallbacks(db: D1Database, items: NewFallback[]): Promise<FallbackRow[]> {
  if (!items.length) return [];
  const statements = items.map((item) =>
    db
      .prepare(
        `INSERT INTO fallbacks (id, user_id, message_id, trigger_kind, after_minutes, destinations, priority, source, origin, status, due_at, channel_names, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING *`,
      )
      .bind(
        randomId("fbk"),
        item.userId,
        item.messageId,
        item.when,
        item.afterMinutes,
        JSON.stringify(item.destinations),
        item.priority,
        item.source,
        item.origin,
        item.createdAt + item.afterMinutes * 60_000,
        JSON.stringify(item.channelNames),
        item.createdAt,
      ),
  );
  const results = await db.batch<FallbackRow>(statements);
  return results.flatMap((result) => result.results);
}

/** Moves due rows to sending in one statement, so two overlapping cron runs never send the same step. */
export async function claimDueFallbacks(db: D1Database, now: number, limit = 25): Promise<FallbackRow[]> {
  const { results } = await db
    .prepare(
      `UPDATE fallbacks SET status = 'sending', fired_at = ?1
       WHERE status = 'pending' AND id IN (SELECT id FROM fallbacks WHERE status = 'pending' AND due_at <= ?1 ORDER BY due_at LIMIT ?2)
       RETURNING *`,
    )
    .bind(now, limit)
    .all<FallbackRow>();
  return results.sort((a, b) => a.due_at - b.due_at);
}

export async function claimFallback(db: D1Database, id: string, now: number): Promise<boolean> {
  const row = await db.prepare("UPDATE fallbacks SET status = 'sending', fired_at = ? WHERE id = ? AND status = 'pending' RETURNING id").bind(now, id).first();
  return row !== null;
}

export async function finishFallback(db: D1Database, id: string, status: Exclude<FallbackStatus, "pending" | "sending">, detail: string, channelNames?: string[]): Promise<void> {
  await db
    .prepare("UPDATE fallbacks SET status = ?, detail = ?, channel_names = COALESCE(?, channel_names) WHERE id = ?")
    .bind(status, detail, channelNames ? JSON.stringify(channelNames) : null, id)
    .run();
}

/** Cancels the message's pending steps. Returns how many it canceled. */
export async function cancelFallbacks(db: D1Database, messageId: string, detail: string): Promise<number> {
  const result = await db
    .prepare("UPDATE fallbacks SET status = 'canceled', detail = ? WHERE message_id = ? AND status = 'pending'")
    .bind(detail, messageId)
    .run();
  return result.meta.changes;
}

/** Rows left in sending by a run that stopped. They are skipped, so a step never sends twice. */
export async function skipStuckFallbacks(db: D1Database, olderThan: number): Promise<void> {
  await db
    .prepare("UPDATE fallbacks SET status = 'skipped', detail = 'Beep Me stopped while it sent this step.' WHERE status = 'sending' AND fired_at < ?")
    .bind(olderThan)
    .run();
}

export async function fallbacksFor(db: D1Database, messageIds: string[]): Promise<FallbackRow[]> {
  if (!messageIds.length) return [];
  const { results } = await db
    .prepare(`SELECT * FROM fallbacks WHERE message_id IN (${messageIds.map(() => "?").join(", ")}) ORDER BY due_at`)
    .bind(...messageIds)
    .all<FallbackRow>();
  return results;
}

export function fallbackDestinations(row: FallbackRow): Destination[] {
  return JSON.parse(row.destinations) as Destination[];
}

export function toFallbackDTO(row: FallbackRow): FallbackDTO {
  return {
    id: row.id,
    when: row.trigger_kind,
    afterMinutes: row.after_minutes,
    dueAt: row.due_at,
    status: row.status,
    channels: JSON.parse(row.channel_names) as string[],
    priority: isPriority(row.priority) ? row.priority : null,
    source: row.source,
    detail: row.detail,
    firedAt: row.status === "pending" ? null : row.fired_at,
  };
}
