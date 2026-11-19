import { errorText, http, isRecord } from "./http";
import { renderEmail } from "./render-email";
import type { ChannelAdapter } from "./types";

/** Sending-only keys cannot read, so there is no verify call. */
export const resend: ChannelAdapter<"resend"> = {
  kind: "resend",

  async send(ctx, message) {
    const { apiKey, from, to } = ctx.config;
    const { subject, text, html } = renderEmail(message);
    const response = await http("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "user-agent": "BeepMe/0.1",
        "idempotency-key": `${message.id}:${ctx.channel.id}`,
      },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    });
    if (!response.ok) return { ok: false, detail: `Resend ${response.status}: ${errorText(response)}` };
    const id = isRecord(response.json) && typeof response.json.id === "string" ? response.json.id : undefined;
    return { ok: true, providerId: id };
  },
};
