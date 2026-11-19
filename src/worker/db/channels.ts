import type { ChannelDTO, ChannelStatus, SecretState, TelegramInfo } from "../../shared/api";
import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import { secretFieldKeys, type ChannelKind, type ChannelTarget } from "../../shared/channels";
import { decryptJson, encryptJson } from "../lib/crypto";

export interface StoredChannel {
  id: string;
  userId: string;
  kind: ChannelKind;
  name: string;
  enabled: boolean;
  status: ChannelStatus;
  statusDetail: string | null;
  config: Record<string, unknown>;
  lastUsedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

interface ChannelRow {
  id: string;
  user_id: string;
  kind: ChannelKind;
  name: string;
  config_enc: string;
  enabled: number;
  status: ChannelStatus;
  status_detail: string | null;
  last_used_at: number | null;
  last_error: string | null;
  created_at: number;
}

async function toStored(env: Env, row: ChannelRow): Promise<StoredChannel> {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    name: row.name,
    enabled: row.enabled === 1,
    status: row.status,
    statusDetail: row.status_detail,
    config: await decryptJson<Record<string, unknown>>(env.APP_SECRET, row.config_enc),
    lastUsedAt: row.last_used_at,
    lastError: row.last_error,
    createdAt: row.created_at,
  };
}

export async function listChannels(env: Env, userId: string): Promise<StoredChannel[]> {
  const { results } = await env.DB.prepare("SELECT * FROM channels WHERE user_id = ? ORDER BY created_at").bind(userId).all<ChannelRow>();
  return Promise.all(results.map((row) => toStored(env, row)));
}

export async function getChannel(env: Env, userId: string | null, id: string): Promise<StoredChannel | null> {
  const row = userId
    ? await env.DB.prepare("SELECT * FROM channels WHERE id = ? AND user_id = ?").bind(id, userId).first<ChannelRow>()
    : await env.DB.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<ChannelRow>();
  return row ? toStored(env, row) : null;
}

export async function saveChannel(env: Env, channel: StoredChannel): Promise<void> {
  const now = Date.now();
  const sealed = await encryptJson(env.APP_SECRET, channel.config);
  await env.DB.prepare(
    `INSERT INTO channels (id, user_id, kind, name, config_enc, enabled, status, status_detail, last_used_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, config_enc = excluded.config_enc, enabled = excluded.enabled,
       status = excluded.status, status_detail = excluded.status_detail, updated_at = excluded.updated_at`,
  )
    .bind(
      channel.id,
      channel.userId,
      channel.kind,
      channel.name,
      sealed,
      channel.enabled ? 1 : 0,
      channel.status,
      channel.statusDetail,
      channel.lastUsedAt,
      channel.lastError,
      channel.createdAt,
      now,
    )
    .run();
}

export async function saveChannelConfig(env: Env, id: string, config: Record<string, unknown>): Promise<void> {
  const sealed = await encryptJson(env.APP_SECRET, config);
  await env.DB.prepare("UPDATE channels SET config_enc = ?, updated_at = ? WHERE id = ?").bind(sealed, Date.now(), id).run();
}

export async function recordChannelUse(env: Env, id: string, error: string | null): Promise<void> {
  await env.DB.prepare("UPDATE channels SET last_used_at = ?, last_error = ? WHERE id = ?").bind(Date.now(), error, id).run();
}

export async function deleteChannel(env: Env, userId: string, id: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM channels WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return result.meta.changes > 0;
}

/** The status a channel's config implies, before any provider call. */
export function configStatus(kind: ChannelKind, config: Record<string, unknown>): { status: ChannelStatus; detail: string | null } {
  if (kind === "telegram" && !config.chatId) {
    return { status: "needs_setup", detail: "Open the bot in Telegram and press Start to link your chat." };
  }
  if (kind === "gmail" && config.mode === "oauth" && !config.refreshToken) {
    return { status: "needs_setup", detail: "Connect your Google account to send from Gmail." };
  }
  if (kind === "resend" && !config.from && !config.domain) {
    return { status: "needs_setup", detail: "Pick an agent domain under Domain and replies, or enter a From address." };
  }
  if (kind === "twilio" && typeof config.inboundDetail === "string") return { status: "ready", detail: config.inboundDetail };
  return { status: "ready", detail: null };
}

export function telegramTopicsMode(config: Record<string, unknown>): TelegramInfo["topicsMode"] {
  if (config.privateTopics === true) return "private";
  if (typeof config.topicsChatId === "string" && config.topicsChatId) return "group";
  return "off";
}

export function channelTargets(channel: Pick<StoredChannel, "kind" | "config">): ChannelTarget[] {
  const { kind, config } = channel;
  if (kind === "telegram") {
    if (!config.chatId) return [];
    return telegramTopicsMode(config) === "off" ? ["main"] : ["main", "topic"];
  }
  if (kind === "discord" && config.forumThreads === true) return ["main", "topic"];
  return ["main"];
}

function secretHint(value: unknown): SecretState {
  if (typeof value !== "string" || !value) return { set: false, hint: null };
  return { set: true, hint: value.length > 8 ? value.slice(-4) : null };
}

export function toChannelDTO(channel: StoredChannel): ChannelDTO {
  const info = CHANNEL_CATALOG[channel.kind];
  const secretKeys = new Set(secretFieldKeys(info));
  const config: ChannelDTO["config"] = {};
  const secrets: ChannelDTO["secrets"] = {};
  for (const field of info.fields) {
    const value = channel.config[field.key];
    if (secretKeys.has(field.key)) secrets[field.key] = secretHint(value);
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") config[field.key] = value;
    else config[field.key] = null;
  }
  if (channel.kind === "gmail" && typeof channel.config.email === "string") config.email = channel.config.email;
  const telegram: TelegramInfo | null =
    channel.kind === "telegram"
      ? {
          botUsername: (channel.config.botUsername as string | undefined) ?? null,
          chatLinked: Boolean(channel.config.chatId),
          chatTitle: (channel.config.chatTitle as string | undefined) ?? null,
          topicsMode: telegramTopicsMode(channel.config),
          topicsChatTitle: (channel.config.topicsChatTitle as string | undefined) ?? null,
        }
      : null;
  return {
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    enabled: channel.enabled,
    status: channel.status,
    statusDetail: channel.statusDetail,
    config,
    secrets,
    targets: channelTargets(channel),
    telegram,
    lastUsedAt: channel.lastUsedAt,
    lastError: channel.lastError,
    createdAt: channel.createdAt,
  };
}
