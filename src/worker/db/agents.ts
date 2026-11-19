import type { AgentDTO, AgentKind, AgentStatus } from "../../shared/api";
import { isPriority, type Priority } from "../../shared/priority";
import { randomId, randomString, sha256Hex } from "../lib/crypto";

export interface Agent {
  id: string;
  userId: string;
  name: string;
  kind: AgentKind;
  clientId: string | null;
  clientName: string | null;
  tokenHint: string | null;
  maxPriority: Priority;
  channelIds: string[] | null;
  smsPerHour: number | null;
  messagesPerHour: number | null;
  status: AgentStatus;
  mutedUntil: number | null;
  lastSeenAt: number | null;
  lastUserAgent: string | null;
  createdAt: number;
  revokedAt: number | null;
}

interface AgentRow {
  id: string;
  user_id: string;
  name: string;
  kind: AgentKind;
  client_id: string | null;
  client_name: string | null;
  token_hint: string | null;
  max_priority: string;
  channel_ids: string | null;
  sms_per_hour: number | null;
  messages_per_hour: number | null;
  status: AgentStatus;
  muted_until: number | null;
  last_seen_at: number | null;
  last_user_agent: string | null;
  created_at: number;
  revoked_at: number | null;
  sent_24h?: number;
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    kind: row.kind,
    clientId: row.client_id,
    clientName: row.client_name,
    tokenHint: row.token_hint,
    maxPriority: isPriority(row.max_priority) ? row.max_priority : "medium",
    channelIds: row.channel_ids ? (JSON.parse(row.channel_ids) as string[]) : null,
    smsPerHour: row.sms_per_hour,
    messagesPerHour: row.messages_per_hour,
    status: row.status,
    mutedUntil: row.muted_until,
    lastSeenAt: row.last_seen_at,
    lastUserAgent: row.last_user_agent,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export function toAgentDTO(agent: Agent, sent24h = 0): AgentDTO {
  const { userId: _userId, clientId: _clientId, ...rest } = agent;
  return { ...rest, sent24h };
}

export const AGENT_TOKEN_PREFIX = "beep_";

export function newAgentToken(): string {
  return `${AGENT_TOKEN_PREFIX}${randomString(40)}`;
}

export async function getAgent(db: D1Database, id: string, userId?: string): Promise<Agent | null> {
  const row = userId
    ? await db.prepare("SELECT * FROM agents WHERE id = ? AND user_id = ?").bind(id, userId).first<AgentRow>()
    : await db.prepare("SELECT * FROM agents WHERE id = ?").bind(id).first<AgentRow>();
  return row ? toAgent(row) : null;
}

export async function findAgentByToken(db: D1Database, token: string): Promise<Agent | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const row = await db.prepare("SELECT * FROM agents WHERE token_hash = ?").bind(await sha256Hex(token)).first<AgentRow>();
  return row ? toAgent(row) : null;
}

export async function listAgents(db: D1Database, userId: string): Promise<AgentDTO[]> {
  const since = Date.now() - 86_400_000;
  const { results } = await db
    .prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM messages m WHERE m.agent_id = a.id AND m.created_at > ?) AS sent_24h
       FROM agents a WHERE a.user_id = ? ORDER BY a.status = 'revoked', COALESCE(a.last_seen_at, a.created_at) DESC`,
    )
    .bind(since, userId)
    .all<AgentRow>();
  return results.map((row) => toAgentDTO(toAgent(row), row.sent_24h ?? 0));
}

export async function listClientAgents(db: D1Database, userId: string, clientId: string): Promise<Agent[]> {
  const { results } = await db
    .prepare("SELECT * FROM agents WHERE user_id = ? AND client_id = ? AND status = 'active' ORDER BY created_at DESC")
    .bind(userId, clientId)
    .all<AgentRow>();
  return results.map(toAgent);
}

export interface NewAgent {
  userId: string;
  name: string;
  kind: AgentKind;
  clientId?: string | null;
  clientName?: string | null;
  maxPriority: Priority;
  channelIds: string[] | null;
}

export async function createAgent(db: D1Database, input: NewAgent, token?: string): Promise<Agent> {
  const now = Date.now();
  const id = randomId("agt");
  const tokenHash = token ? await sha256Hex(token) : null;
  const tokenHint = token ? token.slice(-4) : null;
  await db
    .prepare(
      `INSERT INTO agents (id, user_id, name, kind, client_id, client_name, token_hash, token_hint, max_priority, channel_ids, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .bind(
      id,
      input.userId,
      input.name,
      input.kind,
      input.clientId ?? null,
      input.clientName ?? null,
      tokenHash,
      tokenHint,
      input.maxPriority,
      input.channelIds ? JSON.stringify(input.channelIds) : null,
      now,
    )
    .run();
  const agent = await getAgent(db, id);
  if (!agent) throw new Error("Agent insert failed");
  return agent;
}

export interface AgentPatch {
  name?: string;
  maxPriority?: Priority;
  channelIds?: string[] | null;
  smsPerHour?: number | null;
  messagesPerHour?: number | null;
  mutedUntil?: number | null;
}

export async function updateAgent(db: D1Database, userId: string, id: string, patch: AgentPatch): Promise<Agent | null> {
  const columns: Record<keyof AgentPatch, string> = {
    name: "name",
    maxPriority: "max_priority",
    channelIds: "channel_ids",
    smsPerHour: "sms_per_hour",
    messagesPerHour: "messages_per_hour",
    mutedUntil: "muted_until",
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, column] of Object.entries(columns) as [keyof AgentPatch, string][]) {
    if (patch[key] === undefined) continue;
    const value = patch[key];
    sets.push(`${column} = ?`);
    values.push(key === "channelIds" ? (value ? JSON.stringify(value) : null) : value);
  }
  if (sets.length) {
    await db.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`).bind(...values, id, userId).run();
  }
  return getAgent(db, id, userId);
}

export async function revokeAgent(db: D1Database, userId: string, id: string): Promise<Agent | null> {
  await db
    .prepare("UPDATE agents SET status = 'revoked', revoked_at = ?, token_hash = NULL WHERE id = ? AND user_id = ?")
    .bind(Date.now(), id, userId)
    .run();
  return getAgent(db, id, userId);
}

export async function setAgentToken(db: D1Database, id: string, token: string): Promise<void> {
  await db.prepare("UPDATE agents SET token_hash = ?, token_hint = ? WHERE id = ?").bind(await sha256Hex(token), token.slice(-4), id).run();
}

export async function deleteAgent(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM agents WHERE id = ? AND user_id = ? AND status = 'revoked'").bind(id, userId).run();
  return result.meta.changes > 0;
}

/** Records activity at most once a minute per agent, to keep writes low. */
export async function touchAgent(db: D1Database, id: string, userAgent: string | null): Promise<void> {
  const now = Date.now();
  await db
    .prepare("UPDATE agents SET last_seen_at = ?, last_user_agent = COALESCE(?, last_user_agent) WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)")
    .bind(now, userAgent?.slice(0, 200) ?? null, id, now - 60_000)
    .run();
}
