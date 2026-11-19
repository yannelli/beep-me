import { basicAuth, clip, http, isRecord, errorText, type HttpResponse } from "./http";
import { smsText } from "./sms";
import type { ChannelAdapter } from "./types";

const API = "https://api.twilio.com/2010-04-01/Accounts";

export const twilio: ChannelAdapter<"twilio"> = {
  kind: "twilio",

  async send(ctx, message) {
    const { accountSid, authToken, from, to } = ctx.config;
    const form = new URLSearchParams({ To: to, Body: smsText(message) });
    form.set(from.startsWith("MG") ? "MessagingServiceSid" : "From", from);
    if (ctx.statusCallbackUrl) form.set("StatusCallback", ctx.statusCallbackUrl);
    const response = await http(`${API}/${accountSid}/Messages.json`, {
      method: "POST",
      headers: { authorization: basicAuth(accountSid, authToken), "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    if (!response.ok) return { ok: false, detail: twilioError(response) };
    const sid = isRecord(response.json) && typeof response.json.sid === "string" ? response.json.sid : undefined;
    return { ok: true, providerId: sid };
  },

  async verify(ctx) {
    const { accountSid, authToken } = ctx.config;
    const response = await http(`${API}/${accountSid}.json`, { headers: { authorization: basicAuth(accountSid, authToken) } });
    if (!response.ok) return { ok: false, detail: twilioError(response) };
    const json = isRecord(response.json) ? response.json : {};
    const name = typeof json.friendly_name === "string" ? json.friendly_name : accountSid;
    const status = typeof json.status === "string" ? json.status : "active";
    if (status !== "active") return { ok: false, detail: `Twilio account ${name} is ${status}.` };
    return { ok: true, detail: `Connected to Twilio account ${name}.` };
  },
};

function twilioError(response: HttpResponse): string {
  const json = response.json;
  if (isRecord(json) && typeof json.code === "number" && typeof json.message === "string") {
    return clip(`Twilio ${json.code}: ${json.message}`);
  }
  return `Twilio: ${errorText(response)}`;
}
