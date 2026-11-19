import { attachmentKind } from "../core/media";
import { randomString } from "../lib/crypto";
import { basicAuth, clip, http, isRecord, errorText, type HttpResponse } from "./http";
import { fetchProviderMedia, isMediaRejection, smsText, splitAttachments, type MmsLimits } from "./sms";
import type { ChannelAdapter, InboundMedia, VerifyContext } from "./types";

const TWILIO_DEMO_REPLY = "https://demo.twilio.com/welcome/sms/reply";

// Twilio resizes JPEG, PNG, and GIF up to 5 MB per message, and sends MMS to the US, Canada, and Australia.
const MMS: MmsLimits = {
  maxFiles: 10,
  maxTotalBytes: 5 * 1024 * 1024,
  accepts: (mime) => /^image\/(jpeg|png|gif)$/.test(mime),
  reaches: (to) => /^(\+1\d{10}|\+61\d{9})$/.test(to),
};

export function twilioApi(env: Env, accountSid: string): string {
  return `${env.TWILIO_API_URL ?? "https://api.twilio.com"}/2010-04-01/Accounts/${accountSid}`;
}

export const twilio: ChannelAdapter<"twilio"> = {
  kind: "twilio",

  async send(ctx, message) {
    const { accountSid, authToken, from, to } = ctx.config;
    const post = (mediaUrls: string[], links: string[]) => {
      const form = new URLSearchParams({ To: to, Body: smsText(message, links) });
      form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
      for (const url of mediaUrls) form.append("MediaUrl", url);
      if (ctx.statusCallbackUrl) form.set("StatusCallback", ctx.statusCallbackUrl);
      return http(`${twilioApi(ctx.env, accountSid)}/Messages.json`, {
        method: "POST",
        headers: { authorization: basicAuth(accountSid, authToken), "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      });
    };
    const { mediaUrls, links } = splitAttachments(message, to, MMS);
    let response = await post(mediaUrls, links);
    let detail: string | undefined;
    if (isMediaRejection(response, mediaUrls)) {
      detail = `Sent the files as links. MMS failed: ${twilioError(response)}`;
      response = await post([], message.attachments.map((file) => file.url));
    }
    if (!response.ok) return { ok: false, detail: twilioError(response) };
    const sid = isRecord(response.json) && typeof response.json.sid === "string" ? response.json.sid : undefined;
    return { ok: true, providerId: sid, detail };
  },

  async verify(ctx) {
    const { accountSid, authToken } = ctx.config;
    const response = await http(`${twilioApi(ctx.env, accountSid)}.json`, { headers: { authorization: basicAuth(accountSid, authToken) } });
    if (!response.ok) return { ok: false, detail: twilioError(response) };
    const json = isRecord(response.json) ? response.json : {};
    const name = typeof json.friendly_name === "string" ? json.friendly_name : accountSid;
    const status = typeof json.status === "string" ? json.status : "active";
    if (status !== "active") return { ok: false, detail: `Twilio account ${name} is ${status}.` };
    const webhookToken = ctx.config.webhookToken ?? randomString(32);
    const inbound = await connectInbound(ctx, webhookToken);
    return { ok: true, detail: `Connected to Twilio account ${name}. ${inbound}`, patch: { webhookToken, inboundDetail: inbound } };
  },

  async fetchMedia(ctx, ref) {
    const { accountSid, authToken } = ctx.config;
    const ownHost = new URL(ref).origin === new URL(twilioApi(ctx.env, accountSid)).origin;
    return fetchProviderMedia(ref, ownHost ? { authorization: basicAuth(accountSid, authToken) } : undefined);
  },
};

export function twilioInboundUrl(origin: string, channelId: string, webhookToken: string): string {
  return `${origin}/hooks/sms/twilio/${channelId}/${webhookToken}`;
}

// Points the number's incoming message URL at Beep Me when it is empty, the Twilio demo, or an older URL for this channel.
async function connectInbound(ctx: VerifyContext<"twilio">, webhookToken: string): Promise<string> {
  const { accountSid, authToken, from } = ctx.config;
  const origin = ctx.origin.replace(/\/+$/, "");
  if (!origin.startsWith("https://")) return "Replies need an https deployment.";
  const wanted = twilioInboundUrl(origin, ctx.channel.id, webhookToken);
  if (from.startsWith("MG")) return `To get replies, set the incoming message URL of the Messaging Service to ${wanted}`;
  const auth = { authorization: basicAuth(accountSid, authToken) };
  const list = await http(`${twilioApi(ctx.env, accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`, { headers: auth });
  const numbers = isRecord(list.json) && Array.isArray(list.json.incoming_phone_numbers) ? list.json.incoming_phone_numbers : [];
  const number: unknown = numbers[0];
  if (!list.ok || !isRecord(number) || typeof number.sid !== "string") return `Beep Me could not find ${from} in this account.`;
  const current = typeof number.sms_url === "string" ? number.sms_url : "";
  if (current === wanted) return "Replies are on.";
  if (current && current !== TWILIO_DEMO_REPLY && !current.includes(`/hooks/sms/twilio/${ctx.channel.id}/`)) {
    return `Replies are off: ${from} sends incoming texts to another URL. To get replies, set it to ${wanted}`;
  }
  const update = await http(`${twilioApi(ctx.env, accountSid)}/IncomingPhoneNumbers/${number.sid}.json`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ SmsUrl: wanted, SmsMethod: "POST" }).toString(),
  });
  return update.ok ? "Replies are on." : `Replies are off: ${twilioError(update)}`;
}

/** X-Twilio-Signature: base64 HMAC-SHA1 of the full URL followed by each POST parameter name and value, sorted by name. */
export async function twilioSignature(authToken: string, url: string, params: URLSearchParams): Promise<string> {
  const pairs = [...params].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const data = url + pairs.map(([key, value]) => key + value).join("");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)));
  return btoa(String.fromCharCode(...signature));
}

export function twilioMedia(params: URLSearchParams): InboundMedia[] {
  const count = Math.min(Number(params.get("NumMedia") ?? 0) || 0, 10);
  const media: InboundMedia[] = [];
  for (let index = 0; index < count; index++) {
    const url = params.get(`MediaUrl${index}`);
    if (!url) continue;
    const mime = params.get(`MediaContentType${index}`) ?? "application/octet-stream";
    const extension = mime.split("/")[1]?.split(/[;+]/)[0] ?? "bin";
    media.push({ kind: attachmentKind(mime), name: `media-${index + 1}.${extension}`, mime, size: null, ref: url });
  }
  return media;
}

function twilioError(response: HttpResponse): string {
  const json = response.json;
  if (isRecord(json) && typeof json.code === "number" && typeof json.message === "string") {
    return clip(`Twilio ${json.code}: ${json.message}`);
  }
  return `Twilio: ${errorText(response)}`;
}
