import { clip, errorText, http, isHttpUrl, isRecord, type HttpResponse } from "./http";
import { DOT, optionsText, parts, plainText } from "./render";
import { base64 } from "./render-email";
import type { Priority } from "../../shared/priority";
import type { ChannelAdapter, OutboundAttachment } from "./types";

const API = "https://api.pushover.net/1";
const PRIORITY: Record<Priority, number> = { low: -1, medium: 0, high: 1, urgent: 2 };
const EMERGENCY = { retry: "60", expire: "1800" };
const MESSAGE_MAX = 1024;
const ATTACHMENT_MAX_BYTES = 5_242_880;
const UPLOAD_TIMEOUT_MS = 30_000;

export const pushover: ChannelAdapter<"pushover"> = {
  kind: "pushover",

  async send(ctx, message) {
    const { appToken, userKey, device } = ctx.config;
    const priority = pushoverPriority(message.priority, message.silent);
    const image = await loadImage(message.attachments);
    const tail = [
      ...message.attachments.filter((item) => item !== image?.source).map((item) => `${item.name}: ${item.url}`),
      optionsText(message),
    ]
      .filter(Boolean)
      .join("\n");
    const text = clip(plainText(message), Math.max(MESSAGE_MAX - tail.length - 1, 1));
    const form = new URLSearchParams({
      token: appToken,
      user: userKey,
      title: clip(`${message.agent.name}${DOT}${parts(message).headline}`, 250),
      message: clip(tail ? `${text}\n${tail}` : text, MESSAGE_MAX),
      priority: String(priority),
      timestamp: String(Math.floor(message.createdAt / 1000)),
    });
    if (priority === 2) {
      form.set("retry", EMERGENCY.retry);
      form.set("expire", EMERGENCY.expire);
    }
    if ((message.options.length || message.expectReply) && message.appUrl.length <= 512) {
      form.set("url", message.appUrl);
      form.set("url_title", "Open in Beep Me");
    } else if (isHttpUrl(message.url) && message.url.length <= 512) {
      form.set("url", message.url);
      form.set("url_title", "Open link");
    }
    if (device) form.set("device", device);
    if (image) {
      form.set("attachment_base64", base64(image.bytes));
      form.set("attachment_type", image.source.mime);
    }
    const response = await post("messages.json", form, image ? UPLOAD_TIMEOUT_MS : undefined);
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

/** Pushover takes one image up to 5 MB. Other files, and an image that fails to load, go into the text as links. */
async function loadImage(attachments: OutboundAttachment[]): Promise<{ source: OutboundAttachment; bytes: Uint8Array } | null> {
  const source = attachments.find((item) => item.kind === "image" && (item.size === null || item.size <= ATTACHMENT_MAX_BYTES));
  const bytes = source ? await source.load().catch(() => null) : null;
  return source && bytes && bytes.byteLength <= ATTACHMENT_MAX_BYTES ? { source, bytes } : null;
}

function post(path: string, form: URLSearchParams, timeoutMs?: number): Promise<HttpResponse> {
  return http(`${API}/${path}`, {
    method: "POST",
    timeoutMs,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
}

function accepted(response: HttpResponse): boolean {
  return isRecord(response.json) && response.json.status === 1;
}
