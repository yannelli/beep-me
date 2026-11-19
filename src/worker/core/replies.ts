import type { InteractionDTO } from "../../shared/api";
import type { ChannelKind } from "../../shared/channels";
import { adapters } from "../channels/index";
import type { ChannelAdapter, InboundMedia } from "../channels/types";
import { getChannel } from "../db/channels";
import { listInteractionsForAgent, markInteractionsRead, toInteractionDTO, type InteractionRow } from "../db/interactions";
import { pollTelegramForAgent } from "../hooks/telegram";
import { base64url } from "../lib/crypto";
import { sendContext } from "./deliver";

export interface ReplyQuery {
  messageId?: string;
  since?: number;
  /** 0 returns at once. Up to 50 seconds of polling every 2 seconds until something arrives. */
  waitSeconds: number;
  includeRead: boolean;
  limit: number;
}

export interface ReplyBatch {
  replies: InteractionDTO[];
  rows: InteractionRow[];
  waitedSeconds: number;
}

/** Returns the agent's unread interactions (or all, with includeRead) and marks them read. */
export async function fetchReplies(env: Env, origin: string, agentId: string, query: ReplyQuery): Promise<ReplyBatch> {
  const started = Date.now();
  const wait = Math.min(Math.max(query.waitSeconds, 0), 50) * 1000;
  let rows: InteractionRow[] = [];
  for (;;) {
    if (!origin.startsWith("https://")) await pollTelegramForAgent(env, agentId);
    rows = await listInteractionsForAgent(env.DB, agentId, {
      messageId: query.messageId,
      since: query.since,
      unreadOnly: !query.includeRead,
      limit: query.limit,
    });
    if (rows.length || Date.now() - started + 2000 > wait) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await markInteractionsRead(env.DB, rows.map((row) => row.id));
  await acknowledgeRead(env, rows.filter((row) => row.read_at === null));
  return { replies: rows.map((row) => toInteractionDTO(row, `${origin}/v1/media`)), rows, waitedSeconds: Math.round((Date.now() - started) / 1000) };
}

/** Calls each channel's markRead hook, for example a Telegram reaction on the answer. Errors do not fail the read. */
async function acknowledgeRead(env: Env, rows: InteractionRow[]): Promise<void> {
  const byChannel = new Map<string, { userId: string; refs: string[] }>();
  for (const row of rows) {
    if (!row.provider_ref) continue;
    const entry = byChannel.get(row.channel_id) ?? { userId: row.user_id, refs: [] };
    entry.refs.push(row.provider_ref);
    byChannel.set(row.channel_id, entry);
  }
  await Promise.all(
    [...byChannel].map(async ([channelId, entry]) => {
      const channel = await getChannel(env, entry.userId, channelId);
      const adapter = channel ? (adapters[channel.kind] as ChannelAdapter<ChannelKind>) : null;
      if (!channel || !adapter?.markRead) return;
      await adapter.markRead(sendContext(env, channel, "main", null), entry.refs).catch((error: unknown) => console.error("markRead failed", channel.kind, error));
    }),
  );
}

const MEDIA_HEADERS = { "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" };

/** Streams an inbound file through the channel adapter. The caller checks that the interaction belongs to the requester. */
export async function interactionMedia(env: Env, row: InteractionRow, index: number): Promise<Response> {
  const media = (JSON.parse(row.media) as InboundMedia[])[index];
  if (!media) return new Response("Not found", { status: 404 });
  const channel = await getChannel(env, row.user_id, row.channel_id);
  if (!channel) return new Response("The channel for this file was deleted.", { status: 404 });
  const adapter = adapters[channel.kind] as ChannelAdapter<ChannelKind>;
  if (!adapter.fetchMedia) return new Response("This channel cannot fetch files.", { status: 404 });
  const upstream = await adapter.fetchMedia(sendContext(env, channel, "main", null), media.ref);
  if (!upstream.ok) return new Response(`The provider returned HTTP ${upstream.status}.`, { status: 502 });
  return new Response(upstream.body, {
    headers: { ...MEDIA_HEADERS, "content-type": media.mime, "content-disposition": `inline; filename="${media.name.replace(/"/g, "")}"` },
  });
}

const INLINE_LIMIT = 1_500_000;

/** Up to three small images as MCP image blocks, so the agent sees what you sent without an extra request. */
export async function imageBlocks(env: Env, rows: InteractionRow[]): Promise<{ type: "image"; data: string; mimeType: string }[]> {
  const blocks: { type: "image"; data: string; mimeType: string }[] = [];
  for (const row of rows) {
    const media = JSON.parse(row.media) as InboundMedia[];
    for (const [index, item] of media.entries()) {
      if (blocks.length >= 3 || item.kind !== "image" || (item.size ?? 0) > INLINE_LIMIT) continue;
      const response = await interactionMedia(env, row, index).catch(() => null);
      if (!response?.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > INLINE_LIMIT) continue;
      const base64 = base64url(bytes).replace(/-/g, "+").replace(/_/g, "/");
      blocks.push({ type: "image", data: base64 + "===".slice((base64.length + 3) % 4), mimeType: item.mime });
    }
  }
  return blocks;
}
