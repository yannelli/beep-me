import { Hono } from "hono";
import type { DeliveryStatus } from "../../shared/api";
import type { AppEnv } from "../auth/session";
import { toGsm } from "../channels/sms";
import { twilioMedia, twilioSignature } from "../channels/twilio";
import type { InboundMedia } from "../channels/types";
import { getChannel, type StoredChannel } from "../db/channels";
import { latestMessageForChannel, recordInteraction } from "../db/interactions";
import { updateDeliveryStatus } from "../db/messages";
import { hmacVerify, timingSafeEqual } from "../lib/crypto";

export const smsHook = new Hono<AppEnv>();

const TWILIO: Record<string, DeliveryStatus> = { delivered: "delivered", undelivered: "failed", failed: "failed", sent: "sent" };
const TELNYX: Record<string, DeliveryStatus> = { delivered: "delivered", delivery_failed: "failed", sending_failed: "failed", sent: "sent" };
const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Inbound texts from Twilio. The path carries the channel id and its webhook token; the body is signed with the auth token. */
smsHook.post("/twilio/:channelId/:token", async (c) => {
  const channel = await getChannel(c.env, null, c.req.param("channelId"));
  if (!channel || channel.kind !== "twilio" || !webhookTokenMatches(channel, c.req.param("token"))) return c.json({ ok: false }, 403);
  const params = new URLSearchParams(await c.req.text());
  const url = new URL(c.req.url);
  const expected = await twilioSignature(String(channel.config.authToken), `${c.get("origin")}${url.pathname}${url.search}`, params);
  if (!timingSafeEqual(expected, c.req.header("x-twilio-signature") ?? "")) return c.json({ ok: false }, 403);
  const from = String(channel.config.from);
  if (from.startsWith("+") && params.get("To") !== from) return twiml();
  await recordInboundText(c.env, channel, {
    from: params.get("From") ?? "",
    text: params.get("Body") ?? "",
    media: twilioMedia(params),
    providerRef: params.get("MessageSid") ?? params.get("SmsSid"),
    optOut: ["STOP", "HELP"].includes(params.get("OptOutType") ?? ""),
  });
  return twiml();
});

function twiml(): Response {
  return new Response(EMPTY_TWIML, { headers: { "content-type": "text/xml" } });
}

/** Delivery receipts from Twilio (form body) and Telnyx (JSON). The URL carries an HMAC of the delivery id. */
smsHook.post("/:deliveryId/:signature", async (c) => {
  const { deliveryId, signature } = c.req.param();
  if (!(await hmacVerify(c.env.APP_SECRET, "callback", deliveryId, signature))) return c.json({ ok: false }, 403);
  const contentType = c.req.header("content-type") ?? "";
  let status: DeliveryStatus | undefined;
  let detail: string | null = null;
  if (contentType.includes("application/json")) {
    const body = await c.req.json<{ data?: { payload?: { to?: { status?: string }[]; errors?: { title?: string; detail?: string }[] } } }>();
    const payload = body.data?.payload;
    status = TELNYX[payload?.to?.[0]?.status ?? ""];
    const error = payload?.errors?.[0];
    if (error) detail = `Telnyx: ${error.detail ?? error.title ?? "delivery failed"}`;
  } else {
    const form = await c.req.parseBody();
    status = TWILIO[String(form.MessageStatus ?? "")];
    if (form.ErrorCode) detail = `Twilio error ${String(form.ErrorCode)}`;
  }
  if (status && status !== "sent") await updateDeliveryStatus(c.env.DB, deliveryId, status, detail);
  return c.body(null, 204);
});

export function webhookTokenMatches(channel: StoredChannel, token: string): boolean {
  const stored = channel.config.webhookToken;
  return typeof stored === "string" && stored.length > 0 && timingSafeEqual(stored, token);
}

// Twilio and Telnyx answer these themselves (opt-out, opt-in, help), so Beep Me does not record them.
const CARRIER_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE", "HELP", "INFO", "START", "UNSTOP"]);
const MATCH_WINDOW_MS = 24 * 3_600_000;

export interface InboundText {
  from: string;
  text: string;
  media: InboundMedia[];
  providerRef: string | null;
  /** The provider marked the text as an opt-out, opt-in, or help keyword. */
  optOut?: boolean;
}

/** Records a text from the channel's own mobile number as a reply or a choice on the newest message of the last 24 hours. */
export async function recordInboundText(env: Env, channel: StoredChannel, inbound: InboundText): Promise<void> {
  if (inbound.from !== channel.config.to) return;
  const text = inbound.text.trim();
  if (!inbound.media.length && (inbound.optOut || CARRIER_KEYWORDS.has(text.toUpperCase()))) return;
  const message = await latestMessageForChannel(env.DB, channel.id, { since: Date.now() - MATCH_WINDOW_MS, preferAwaiting: true });
  const optionIndex = message ? matchOption(text, message.options) : null;
  await recordInteraction(env.DB, {
    userId: channel.userId,
    channelId: channel.id,
    channelKind: channel.kind,
    messageId: message?.messageId ?? null,
    matchedBy: message ? "latest" : null,
    kind: optionIndex === null ? "reply" : "choice",
    text: text || null,
    optionIndex,
    media: inbound.media,
    sender: inbound.from,
    providerRef: inbound.providerRef,
  });
}

/** "2" picks the second option. The option text itself also counts, ignoring case, spacing, and characters SMS cannot show. */
export function matchOption(text: string, options: string[]): number | null {
  if (!options.length) return null;
  const answer = text.replace(/[.!]+$/, "").trim();
  if (/^\d{1,2}$/.test(answer)) {
    const index = Number(answer) - 1;
    return index >= 0 && index < options.length ? index : null;
  }
  const normalize = (value: string) => toGsm(value).trim().replace(/\s+/g, " ").toLowerCase();
  const index = options.findIndex((option) => normalize(option) === normalize(answer));
  return index === -1 ? null : index;
}
