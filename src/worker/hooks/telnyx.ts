import { Hono } from "hono";
import type { AppEnv } from "../auth/session";
import { attachmentKind } from "../core/media";
import type { InboundMedia } from "../channels/types";
import { getChannel } from "../db/channels";
import { fromBase64url } from "../lib/crypto";
import { recordInboundText, webhookTokenMatches } from "./sms";

/** Inbound Telnyx messaging webhooks (replies and MMS). Mounted at /hooks/telnyx. */
export const telnyxHook = new Hono<AppEnv>();

const MAX_SKEW_SECONDS = 300;

interface TelnyxInbound {
  data?: {
    event_type?: string;
    payload?: {
      id?: string;
      direction?: string;
      text?: string | null;
      from?: { phone_number?: string };
      to?: { phone_number?: string }[];
      media?: { url?: string; content_type?: string; size?: number }[];
      autoresponse_type?: string | null;
    };
  };
}

telnyxHook.post("/:channelId/:token", async (c) => {
  const channel = await getChannel(c.env, null, c.req.param("channelId"));
  if (!channel || channel.kind !== "telnyx" || !webhookTokenMatches(channel, c.req.param("token"))) return c.json({ ok: false }, 403);
  const raw = await c.req.text();
  const publicKey = typeof channel.config.publicKey === "string" ? channel.config.publicKey : "";
  const signed = await verifyTelnyxSignature(publicKey, c.req.header("telnyx-timestamp") ?? "", c.req.header("telnyx-signature-ed25519") ?? "", raw);
  if (!signed) return c.json({ ok: false }, 403);
  const event = JSON.parse(raw) as TelnyxInbound;
  const payload = event.data?.payload;
  if (event.data?.event_type !== "message.received" || !payload || payload.direction === "outbound") return c.json({ ok: true });
  if (!payload.to?.some((to) => to.phone_number === channel.config.from)) return c.json({ ok: true });
  await recordInboundText(c.env, channel, {
    from: payload.from?.phone_number ?? "",
    text: payload.text ?? "",
    media: telnyxMedia(payload.media ?? []),
    providerRef: payload.id ?? null,
    optOut: Boolean(payload.autoresponse_type),
  });
  return c.json({ ok: true });
});

/** Telnyx signs "<telnyx-timestamp>|<raw body>" with the account's Ed25519 key. Both values are Base64. */
export async function verifyTelnyxSignature(publicKey: string, timestamp: string, signature: string, raw: string): Promise<boolean> {
  const seconds = Number(timestamp);
  if (!publicKey || !signature || !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > MAX_SKEW_SECONDS) return false;
  try {
    const key = await crypto.subtle.importKey("raw", fromBase64(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromBase64(signature), new TextEncoder().encode(`${timestamp}|${raw}`));
  } catch {
    return false;
  }
}

function fromBase64(value: string): Uint8Array {
  return fromBase64url(value.trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

function telnyxMedia(items: { url?: string; content_type?: string; size?: number }[]): InboundMedia[] {
  return items
    .filter((item): item is { url: string; content_type?: string; size?: number } => typeof item.url === "string")
    .map((item, index) => {
      const mime = item.content_type?.split(";")[0]?.trim() || "application/octet-stream";
      const extension = mime.split("/")[1]?.split("+")[0] ?? "bin";
      return { kind: attachmentKind(mime), name: `media-${index + 1}.${extension}`, mime, size: typeof item.size === "number" ? item.size : null, ref: item.url };
    });
}
