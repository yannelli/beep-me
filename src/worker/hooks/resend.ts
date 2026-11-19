import { Hono } from "hono";
import type { ChannelConfig } from "../../shared/channel-configs";
import type { AppEnv } from "../auth/session";
import { htmlToText, parseChoice, parseHeaderBlock, stripQuoted } from "../channels/email-reply";
import { isRecord } from "../channels/http";
import { base64, utf8 } from "../channels/render-email";
import { agentTag, emailDomain, messageIdsIn, resendRequest, tagFromAddress } from "../channels/resend-api";
import type { InboundMedia } from "../channels/types";
import { attachmentKind, safeFileName } from "../core/media";
import { listAgents } from "../db/agents";
import { getChannel, type StoredChannel } from "../db/channels";
import { recordInteraction, type MatchedMessage } from "../db/interactions";
import { timingSafeEqual } from "../lib/crypto";

/** Inbound Resend email webhooks (replies by email), one URL per channel: /hooks/resend/<channel id>. */
export const resendHook = new Hono<AppEnv>();

const TOLERANCE_SECONDS = 300;

/** Svix signature: HMAC-SHA256 of "<id>.<timestamp>.<body>" with the base64 key after "whsec_". */
export async function verifySvix(secret: string, headers: { id?: string; timestamp?: string; signature?: string }, body: string): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  const seconds = Number(timestamp);
  if (!id || !signature || !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > TOLERANCE_SECONDS) return false;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (char) => char.charCodeAt(0));
  } catch {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = base64(new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8(`${id}.${timestamp}.${body}`))));
  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",");
    return version === "v1" && Boolean(value) && timingSafeEqual(value, expected);
  });
}

interface ReceivedEvent {
  type?: string;
  data?: { email_id?: string; from?: string; to?: string[] };
}

interface ReceivedEmail {
  text?: string | null;
  html?: string | null;
  headers?: Record<string, string>;
  raw?: { download_url?: string } | null;
  attachments?: { id: string; filename?: string; content_type?: string; size?: number }[];
}

resendHook.post("/:channelId", async (c) => {
  const channel = await getChannel(c.env, null, c.req.param("channelId"));
  const secret = channel?.kind === "resend" ? channel.config.webhookSecret : undefined;
  const body = await c.req.text();
  const signed = { id: c.req.header("svix-id"), timestamp: c.req.header("svix-timestamp"), signature: c.req.header("svix-signature") };
  if (!channel || typeof secret !== "string" || !(await verifySvix(secret, signed, body))) return c.json({ ok: false }, 403);
  const event = JSON.parse(body) as ReceivedEvent;
  if (event.type !== "email.received" || !event.data?.email_id) return c.json({ ok: true, ignored: "event" });
  const outcome = await handleReceived(c.env, channel, event.data.email_id, event.data);
  return c.json({ ok: outcome !== "retry", outcome }, outcome === "retry" ? 502 : 200);
});

async function handleReceived(env: Env, channel: StoredChannel, emailId: string, data: NonNullable<ReceivedEvent["data"]>): Promise<string> {
  const config = channel.config as ChannelConfig<"resend">;
  const domain = config.domain ?? (config.from ? emailDomain(config.from) : null);
  const recipients = (data.to ?? []).map((address) => address.trim().toLowerCase());
  if (!domain || !recipients.some((address) => emailDomain(address) === domain)) return "other domain";
  const sender = (data.from ?? "").trim().toLowerCase();
  if (sender !== config.to.toLowerCase()) return "unknown sender";

  const response = await resendRequest(config, `/emails/receiving/${encodeURIComponent(emailId)}`);
  if (!response.ok || !isRecord(response.json)) return "retry";
  const email = response.json as ReceivedEmail;
  const headers = await threadingHeaders(email);
  const message = await findThreadMessage(env.DB, channel, messageIdsIn(headers["in-reply-to"], headers.references));
  const tags = recipients.map((address) => tagFromAddress(address, domain)).filter((tag): tag is string => Boolean(tag));
  const agentId = message?.agentId ?? (tags.length ? await agentForTags(env.DB, channel.userId, tags) : null);

  const text = stripQuoted(email.text?.trim() ? email.text : htmlToText(email.html ?? ""));
  const optionIndex = message ? parseChoice(text, message.options) : null;
  const media: InboundMedia[] = (email.attachments ?? []).map((file) => {
    const mime = file.content_type || "application/octet-stream";
    return { kind: attachmentKind(mime), name: safeFileName(file.filename ?? "attachment"), mime, size: file.size ?? null, ref: `${emailId}/${file.id}` };
  });
  if (!text && !media.length) return "empty";
  await recordInteraction(env.DB, {
    userId: channel.userId,
    channelId: channel.id,
    channelKind: "resend",
    messageId: message?.messageId ?? null,
    agentId,
    kind: optionIndex === null ? "reply" : "choice",
    text: text || null,
    optionIndex,
    media,
    sender,
    providerRef: emailId,
  });
  return "recorded";
}

/** Reads In-Reply-To and References from the parsed headers, or from the top of the raw message when Resend leaves them out. */
async function threadingHeaders(email: ReceivedEmail): Promise<Record<string, string | undefined>> {
  const headers = Object.fromEntries(Object.entries(email.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
  if (headers["in-reply-to"] || headers.references || !email.raw?.download_url) return headers;
  const response = await fetch(email.raw.download_url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const reader = response?.ok ? response.body?.getReader() : undefined;
  if (!reader) return headers;
  let raw = "";
  const decoder = new TextDecoder();
  while (raw.length < 65_536 && !/\r?\n\r?\n/.test(raw)) {
    const { value, done } = await reader.read();
    if (done) break;
    raw += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => undefined);
  return { ...parseHeaderBlock(raw), ...headers };
}

async function findThreadMessage(db: D1Database, channel: StoredChannel, messageIds: string[]): Promise<MatchedMessage | null> {
  for (const id of messageIds) {
    const row = await db
      .prepare(
        `SELECT m.id, m.agent_id, m.options FROM deliveries d JOIN messages m ON m.id = d.message_id
         WHERE d.channel_id = ? AND m.id = ? AND m.user_id = ? LIMIT 1`,
      )
      .bind(channel.id, id, channel.userId)
      .first<{ id: string; agent_id: string | null; options: string }>();
    if (row) return { messageId: row.id, agentId: row.agent_id, options: JSON.parse(row.options) as string[] };
  }
  return null;
}

async function agentForTags(db: D1Database, userId: string, tags: string[]): Promise<string | null> {
  for (const agent of await listAgents(db, userId)) {
    if (tags.includes(await agentTag(agent.id))) return agent.id;
  }
  return null;
}
