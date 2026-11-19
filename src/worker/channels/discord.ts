import { clip, errorText, http, isHttpUrl, isRecord, type HttpResponse } from "./http";
import { discordEmbed, type DiscordFiles } from "./render";
import type { ChannelAdapter, OutboundAttachment, OutboundMessage, SendContext, SendResult } from "./types";

const SUPPRESS_NOTIFICATIONS = 1 << 12;
const THREAD_NAME_MAX = 100;
const UNKNOWN_CHANNEL = 10003;
const THREAD_ARCHIVED = 50083;
const REQUEST_TOO_LARGE = 40005;
const FILE_TOO_LARGE = 50045;
const MAX_FILES = 10;
/** Discord's default per-file limit is 20 MiB. Beep Me also keeps the whole upload under it. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 30_000;
/** Forum webhooks reject posts without a thread, so untopiced messages go to one shared post. */
const GENERAL_THREAD = { key: "__beepme_general__", name: "Beep Me" };

type Topic = { key: string; name: string };
type Upload = { source: OutboundAttachment; filename: string; bytes: Uint8Array };

export const discord: ChannelAdapter<"discord"> = {
  kind: "discord",

  async send(ctx, message) {
    const uploads = await loadUploads(message.attachments);
    let response = await post(ctx, message, uploads);
    if (uploads.length && tooLarge(response)) response = await post(ctx, message, []);
    return result(response);
  },

  async verify(ctx) {
    const response = await http(ctx.config.webhookUrl);
    if (!response.ok) return { ok: false, detail: discordError(response) };
    const name = isRecord(response.json) && typeof response.json.name === "string" ? response.json.name : "Discord webhook";
    return { ok: true, detail: `Connected to webhook ${name}.` };
  },
};

function post(ctx: SendContext<"discord">, message: OutboundMessage, uploads: Upload[]): Promise<HttpResponse> {
  const payload = {
    username: "Beep Me",
    embeds: [discordEmbed(message, embedFiles(message.attachments, uploads))],
    allowed_mentions: { parse: [] },
    ...(message.silent ? { flags: SUPPRESS_NOTIFICATIONS } : {}),
    ...(uploads.length ? { attachments: uploads.map((upload, id) => ({ id, filename: upload.filename })) } : {}),
  };
  if (!ctx.config.forumThreads) return execute(ctx.config.webhookUrl, payload, uploads);
  const topic = ctx.target === "topic" && message.topic ? message.topic : GENERAL_THREAD;
  return sendToThread(ctx, topic, payload, uploads);
}

async function sendToThread(ctx: SendContext<"discord">, topic: Topic, payload: object, uploads: Upload[]): Promise<HttpResponse> {
  const stored = await ctx.threads.get(topic.key);
  if (stored) {
    const response = await execute(ctx.config.webhookUrl, payload, uploads, stored);
    if (response.ok || !threadGone(response)) return response;
    await ctx.threads.delete(topic.key);
  }
  const name = clip(topic.name.trim() || topic.key, THREAD_NAME_MAX);
  const response = await execute(ctx.config.webhookUrl, { ...payload, thread_name: name }, uploads);
  const json = isRecord(response.json) ? response.json : {};
  const threadId = typeof json.channel_id === "string" ? json.channel_id : typeof json.id === "string" ? json.id : null;
  if (response.ok && threadId) await ctx.threads.set(topic.key, threadId);
  return response;
}

function execute(webhookUrl: string, payload: object, uploads: Upload[], threadId?: string): Promise<HttpResponse> {
  const url = new URL(webhookUrl);
  url.searchParams.set("wait", "true");
  if (threadId) url.searchParams.set("thread_id", threadId);
  if (!uploads.length) {
    return http(url.toString(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  }
  const form = new FormData();
  form.append("payload_json", JSON.stringify(payload));
  uploads.forEach((upload, index) => form.append(`files[${index}]`, new Blob([upload.bytes], { type: upload.source.mime }), upload.filename));
  return http(url.toString(), { method: "POST", body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
}

/** Loads files in order until Discord's count or size limit. Files that do not fit or fail to load go out as links. */
async function loadUploads(attachments: OutboundAttachment[]): Promise<Upload[]> {
  const uploads: Upload[] = [];
  let total = 0;
  for (const source of attachments) {
    if (uploads.length === MAX_FILES || (source.size !== null && total + source.size > MAX_UPLOAD_BYTES)) continue;
    const bytes = await source.load().catch(() => null);
    if (!bytes || total + bytes.byteLength > MAX_UPLOAD_BYTES) continue;
    total += bytes.byteLength;
    uploads.push({ source, filename: uniqueName(source.name, uploads), bytes });
  }
  return uploads;
}

function uniqueName(name: string, taken: Upload[]): string {
  const safe = name.replace(/[^\w.-]+/g, "_") || "file";
  return taken.some((upload) => upload.filename === safe) ? `${taken.length + 1}_${safe}` : safe;
}

/** The first image becomes the embed image. Every other file that was not uploaded becomes a link. */
function embedFiles(attachments: OutboundAttachment[], uploads: Upload[]): DiscordFiles {
  const image = attachments.find((attachment) => attachment.kind === "image");
  const uploadedImage = uploads.find((upload) => upload.source === image);
  const linkedImage = !uploadedImage && image && isHttpUrl(image.url) ? image : null;
  return {
    image: uploadedImage ? `attachment://${uploadedImage.filename}` : (linkedImage?.url ?? null),
    links: attachments.filter((item) => item !== linkedImage && !uploads.some((upload) => upload.source === item)),
  };
}

function tooLarge(response: HttpResponse): boolean {
  const code = isRecord(response.json) ? response.json.code : null;
  return response.status === 413 || code === REQUEST_TOO_LARGE || code === FILE_TOO_LARGE;
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
