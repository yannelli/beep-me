import { clip, errorText, http, isRecord, type HttpResponse } from "./http";
import { smsText } from "./sms";
import type { ChannelAdapter } from "./types";

const API = "https://api.telnyx.com/v2";

export const telnyx: ChannelAdapter<"telnyx"> = {
  kind: "telnyx",

  async send(ctx, message) {
    const { apiKey, from, to, messagingProfileId } = ctx.config;
    const response = await http(`${API}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        text: smsText(message),
        ...(messagingProfileId ? { messaging_profile_id: messagingProfileId } : {}),
        ...(ctx.statusCallbackUrl ? { webhook_url: ctx.statusCallbackUrl } : {}),
      }),
    });
    if (!response.ok) return { ok: false, detail: telnyxError(response) };
    const data = isRecord(response.json) && isRecord(response.json.data) ? response.json.data : {};
    return { ok: true, providerId: typeof data.id === "string" ? data.id : undefined };
  },

  async verify(ctx) {
    const response = await http(`${API}/messaging_profiles?page[size]=1`, {
      headers: { authorization: `Bearer ${ctx.config.apiKey}` },
    });
    if (!response.ok) return { ok: false, detail: telnyxError(response) };
    return { ok: true, detail: "Telnyx API key works." };
  },
};

function telnyxError(response: HttpResponse): string {
  const json = response.json;
  const first = isRecord(json) && Array.isArray(json.errors) && isRecord(json.errors[0]) ? json.errors[0] : null;
  if (!first) return `Telnyx: ${errorText(response)}`;
  const code = typeof first.code === "string" || typeof first.code === "number" ? ` ${first.code}` : "";
  const text = [first.title, first.detail].filter((part) => typeof part === "string" && part).join(": ");
  return clip(`Telnyx${code}: ${text || `HTTP ${response.status}`}`);
}
