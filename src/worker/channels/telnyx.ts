import { randomString } from "../lib/crypto";
import { clip, errorText, http, isRecord, type HttpResponse } from "./http";
import { fetchProviderMedia, isMediaRejection, smsText, splitAttachments, type MmsLimits } from "./sms";
import type { ChannelAdapter } from "./types";

const MMS_TYPES = /^(image\/(jpeg|png|gif|bmp|tiff|webp)|video\/(mp4|3gpp|quicktime)|audio\/(mpeg|wav|amr|ogg)|application\/pdf|text\/(vcard|x-vcard|calendar))$/;

// Telnyx asks for less than 1 MB of media in total, up to 10 files, to US and Canada numbers.
const MMS: MmsLimits = { maxFiles: 10, maxTotalBytes: 1_000_000, accepts: (mime) => MMS_TYPES.test(mime), reaches: (to) => /^\+1\d{10}$/.test(to) };

export function telnyxApi(env: Env): string {
  return `${env.TELNYX_API_URL ?? "https://api.telnyx.com"}/v2`;
}

export const telnyx: ChannelAdapter<"telnyx"> = {
  kind: "telnyx",

  async send(ctx, message) {
    const { apiKey, from, to, messagingProfileId } = ctx.config;
    const post = (mediaUrls: string[], links: string[]) =>
      http(`${telnyxApi(ctx.env)}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          text: smsText(message, links),
          ...(mediaUrls.length ? { media_urls: mediaUrls } : {}),
          ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
          ...(ctx.statusCallbackUrl ? { webhook_url: ctx.statusCallbackUrl } : {}),
        }),
      });
    const { mediaUrls, links } = splitAttachments(message, to, MMS);
    let response = await post(mediaUrls, links);
    let detail: string | undefined;
    if (isMediaRejection(response, mediaUrls)) {
      detail = `Sent the files as links. MMS failed: ${telnyxError(response)}`;
      response = await post([], message.attachments.map((file) => file.url));
    }
    if (!response.ok) return { ok: false, detail: telnyxError(response) };
    const data = isRecord(response.json) && isRecord(response.json.data) ? response.json.data : {};
    return { ok: true, providerId: typeof data.id === "string" ? data.id : undefined, detail };
  },

  async verify(ctx) {
    const response = await http(`${telnyxApi(ctx.env)}/messaging_profiles?page[size]=1`, {
      headers: { authorization: `Bearer ${ctx.config.apiKey}` },
    });
    if (!response.ok) return { ok: false, detail: telnyxError(response) };
    return { ok: true, detail: "Telnyx API key works.", patch: { webhookToken: ctx.config.webhookToken ?? randomString(32) } };
  },

  // Inbound media URLs need the API key and expire after 30 days. Redirects are followed without the key.
  async fetchMedia(ctx, ref) {
    const url = new URL(ref);
    const ownHost = url.hostname === "telnyx.com" || url.hostname.endsWith(".telnyx.com") || ref.startsWith(telnyxApi(ctx.env));
    return fetchProviderMedia(ref, ownHost ? { authorization: `Bearer ${ctx.config.apiKey}` } : undefined);
  },
};

export function telnyxInboundUrl(origin: string, channelId: string, webhookToken: string): string {
  return `${origin}/hooks/telnyx/${channelId}/${webhookToken}`;
}

export function telnyxError(response: HttpResponse): string {
  const json = response.json;
  const first = isRecord(json) && Array.isArray(json.errors) && isRecord(json.errors[0]) ? json.errors[0] : null;
  if (!first) return `Telnyx: ${errorText(response)}`;
  const code = typeof first.code === "string" || typeof first.code === "number" ? ` ${first.code}` : "";
  const text = [first.title, first.detail].filter((part) => typeof part === "string" && part).join(": ");
  return clip(`Telnyx${code}: ${text || `HTTP ${response.status}`}`);
}
