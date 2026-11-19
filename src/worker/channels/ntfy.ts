import { clipBy, errorText, http, isHttpUrl, isRecord, utf8Length } from "./http";
import { parts, plainText } from "./render";
import type { Priority } from "../../shared/priority";
import type { ChannelAdapter } from "./types";

const PRIORITY: Record<Priority, number> = { low: 2, medium: 3, high: 4, urgent: 5 };
const SILENT_PRIORITY = 1;
const MESSAGE_MAX_BYTES = 4096;

export const ntfy: ChannelAdapter<"ntfy"> = {
  kind: "ntfy",

  async send(ctx, message) {
    const { server, topic, token } = ctx.config;
    const click = isHttpUrl(message.url) ? message.url : message.appUrl.startsWith("https://") ? message.appUrl : undefined;
    const tags = [message.test ? "test_tube" : null, message.topic?.key ?? null].filter((tag): tag is string => Boolean(tag));
    const response = await http(server, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        topic,
        title: parts(message).headline,
        message: clipBy(plainText(message), MESSAGE_MAX_BYTES, utf8Length),
        priority: message.silent ? SILENT_PRIORITY : PRIORITY[message.priority],
        tags,
        ...(click ? { click } : {}),
      }),
    });
    if (!response.ok) return { ok: false, detail: `ntfy ${response.status}: ${errorText(response)}` };
    const id = isRecord(response.json) && typeof response.json.id === "string" ? response.json.id : undefined;
    return { ok: true, providerId: id };
  },
};
