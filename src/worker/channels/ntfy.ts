import { clipBy, errorText, http, isHttpUrl, isRecord, utf8Length } from "./http";
import { optionsText, parts, plainText } from "./render";
import { hmacSign } from "../lib/crypto";
import type { Priority } from "../../shared/priority";
import type { ChannelAdapter, OutboundMessage, SendContext } from "./types";

const PRIORITY: Record<Priority, number> = { low: 2, medium: 3, high: 4, urgent: 5 };
const SILENT_PRIORITY = 1;
const MESSAGE_MAX_BYTES = 4096;
const MAX_ACTIONS = 3;

export const ntfy: ChannelAdapter<"ntfy"> = {
  kind: "ntfy",

  async send(ctx, message) {
    const { server, topic, token } = ctx.config;
    const click = isHttpUrl(message.url) ? message.url : message.appUrl.startsWith("https://") ? message.appUrl : undefined;
    const tags = [message.test ? "test_tube" : null, message.topic?.key ?? null].filter((tag): tag is string => Boolean(tag));
    const attachment = message.attachments.find((item) => item.kind === "image") ?? message.attachments[0];
    const tail = [
      ...message.attachments.filter((item) => item !== attachment).map((item) => `${item.name}: ${item.url}`),
      message.options.length > MAX_ACTIONS ? optionsText(message) : null,
    ]
      .filter(Boolean)
      .join("\n");
    const text = clipBy(plainText(message), Math.max(MESSAGE_MAX_BYTES - utf8Length(tail) - 1, 0), utf8Length);
    const actions = await choiceActions(ctx, message);
    const response = await http(server, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        topic,
        title: parts(message).headline,
        message: clipBy(tail ? `${text}\n${tail}` : text, MESSAGE_MAX_BYTES, utf8Length),
        priority: message.silent ? SILENT_PRIORITY : PRIORITY[message.priority],
        tags,
        ...(click ? { click } : {}),
        ...(attachment ? { attach: attachment.url, filename: attachment.name } : {}),
        ...(actions.length ? { actions } : {}),
      }),
    });
    if (!response.ok) return { ok: false, detail: `ntfy ${response.status}: ${errorText(response)}` };
    const id = isRecord(response.json) && typeof response.json.id === "string" ? response.json.id : undefined;
    return { ok: true, providerId: id };
  },
};

/** Up to 3 options become buttons that POST to the signed Beep Me hook. More options get one button that opens the dashboard. */
async function choiceActions(ctx: SendContext<"ntfy">, message: OutboundMessage): Promise<object[]> {
  if (!message.options.length) return [];
  if (message.options.length > MAX_ACTIONS) return [{ action: "view", label: "Open in Beep Me", url: message.appUrl, clear: true }];
  const origin = new URL(message.appUrl).origin;
  return Promise.all(
    message.options.map(async (label, index) => ({
      action: "http",
      label,
      url: `${origin}/hooks/ntfy/${ctx.channel.id}/${message.id}/${index}/${await ntfyChoiceSignature(ctx.env.APP_SECRET, ctx.channel.id, message.id, index)}`,
      method: "POST",
      clear: true,
    })),
  );
}

export function ntfyChoiceSignature(secret: string, channelId: string, messageId: string, index: number): Promise<string> {
  return hmacSign(secret, "callback", `ntfy:${channelId}:${messageId}:${index}`);
}
