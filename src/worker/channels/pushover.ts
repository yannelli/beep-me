import { clip, errorText, http, isHttpUrl, isRecord, type HttpResponse } from "./http";
import { DOT, parts, plainText } from "./render";
import type { Priority } from "../../shared/priority";
import type { ChannelAdapter } from "./types";

const API = "https://api.pushover.net/1";
const PRIORITY: Record<Priority, number> = { low: -1, medium: 0, high: 1, urgent: 2 };
const EMERGENCY = { retry: "60", expire: "1800" };

export const pushover: ChannelAdapter<"pushover"> = {
  kind: "pushover",

  async send(ctx, message) {
    const { appToken, userKey, device } = ctx.config;
    const priority = pushoverPriority(message.priority, message.silent);
    const form = new URLSearchParams({
      token: appToken,
      user: userKey,
      title: clip(`${message.agent.name}${DOT}${parts(message).headline}`, 250),
      message: clip(plainText(message), 1024),
      priority: String(priority),
      timestamp: String(Math.floor(message.createdAt / 1000)),
    });
    if (priority === 2) {
      form.set("retry", EMERGENCY.retry);
      form.set("expire", EMERGENCY.expire);
    }
    if (isHttpUrl(message.url) && message.url.length <= 512) {
      form.set("url", message.url);
      form.set("url_title", "Open link");
    }
    if (device) form.set("device", device);
    const response = await post("messages.json", form);
    if (!response.ok || !accepted(response)) return { ok: false, detail: `Pushover: ${errorText(response)}` };
    const json = isRecord(response.json) ? response.json : {};
    const id = typeof json.receipt === "string" ? json.receipt : typeof json.request === "string" ? json.request : undefined;
    return { ok: true, providerId: id };
  },

  async verify(ctx) {
    const { appToken, userKey, device } = ctx.config;
    const form = new URLSearchParams({ token: appToken, user: userKey, ...(device ? { device } : {}) });
    const response = await post("users/validate.json", form);
    if (!response.ok || !accepted(response)) return { ok: false, detail: `Pushover: ${errorText(response)}` };
    return { ok: true, detail: "Pushover user key is valid and has an active device." };
  },
};

/** Quiet hours drop low and medium to -2 (no alert) and everything else to -1 (no sound). */
export function pushoverPriority(priority: Priority, silent: boolean): number {
  if (!silent) return PRIORITY[priority];
  return PRIORITY[priority] <= 0 ? -2 : -1;
}

function post(path: string, form: URLSearchParams): Promise<HttpResponse> {
  return http(`${API}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

function accepted(response: HttpResponse): boolean {
  return isRecord(response.json) && response.json.status === 1;
}
