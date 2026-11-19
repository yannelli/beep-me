import { clip, errorText, http, isRecord, type HttpResponse } from "./http";
import { discordEmbed } from "./render";
import type { ChannelAdapter, SendContext, SendResult } from "./types";

const SUPPRESS_NOTIFICATIONS = 1 << 12;
const THREAD_NAME_MAX = 100;
const UNKNOWN_CHANNEL = 10003;
const THREAD_ARCHIVED = 50083;
/** Forum webhooks reject posts without a thread, so untopiced messages go to one shared post. */
const GENERAL_THREAD = { key: "__beepme_general__", name: "Beep Me" };

type Topic = { key: string; name: string };

export const discord: ChannelAdapter<"discord"> = {
  kind: "discord",

  async send(ctx, message) {
    const payload = {
      username: "Beep Me",
      embeds: [discordEmbed(message)],
      allowed_mentions: { parse: [] },
      ...(message.silent ? { flags: SUPPRESS_NOTIFICATIONS } : {}),
    };
    if (!ctx.config.forumThreads) return result(await execute(ctx.config.webhookUrl, payload));
    const topic = ctx.target === "topic" && message.topic ? message.topic : GENERAL_THREAD;
    return sendToThread(ctx, topic, payload);
  },

  async verify(ctx) {
    const response = await http(ctx.config.webhookUrl);
    if (!response.ok) return { ok: false, detail: discordError(response) };
    const name = isRecord(response.json) && typeof response.json.name === "string" ? response.json.name : "Discord webhook";
    return { ok: true, detail: `Connected to webhook ${name}.` };
  },
};

async function sendToThread(ctx: SendContext<"discord">, topic: Topic, payload: object): Promise<SendResult> {
  const stored = await ctx.threads.get(topic.key);
  if (stored) {
    const response = await execute(ctx.config.webhookUrl, payload, stored);
    if (response.ok || !threadGone(response)) return result(response);
    await ctx.threads.delete(topic.key);
  }
  const name = clip(topic.name.trim() || topic.key, THREAD_NAME_MAX);
  const response = await execute(ctx.config.webhookUrl, { ...payload, thread_name: name });
  const json = isRecord(response.json) ? response.json : {};
  const threadId = typeof json.channel_id === "string" ? json.channel_id : typeof json.id === "string" ? json.id : null;
  if (response.ok && threadId) await ctx.threads.set(topic.key, threadId);
  return result(response);
}

function execute(webhookUrl: string, payload: object, threadId?: string): Promise<HttpResponse> {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  if (threadId) url.searchParams.set("thread_id", threadId);
  return http(url.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function threadGone(response: HttpResponse): boolean {
  const code = isRecord(response.json) ? response.json.code : null;
  return code === UNKNOWN_CHANNEL || code === THREAD_ARCHIVED;
}

function result(response: HttpResponse): SendResult {
  if (!response.ok) return { ok: false, detail: discordError(response) };
  const id = isRecord(response.json) && typeof response.json.id === "string" ? response.json.id : undefined;
  return { ok: true, providerId: id };
}

function discordError(response: HttpResponse): string {
  const code = isRecord(response.json) && typeof response.json.code === "number" ? ` ${response.json.code}` : "";
  return clip(`Discord ${response.status}${code}: ${errorText(response)}`);
}
