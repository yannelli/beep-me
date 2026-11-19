import { Hono, type Context } from "hono";
import type { CreateChannelBody, TelegramLink, TestResult, UpdateChannelBody } from "../../shared/api";
import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import { channelConfigSchemas } from "../../shared/channel-configs";
import { isChannelKind, secretFieldKeys, type ChannelKind, type ChannelTarget } from "../../shared/channels";
import type { AppEnv } from "../auth/session";
import { adapters } from "../channels/index";
import type { ChannelAdapter, OutboundMessage } from "../channels/types";
import { sendToChannel } from "../core/deliver";
import { configStatus, deleteChannel, getChannel, listChannels, saveChannel, toChannelDTO, type StoredChannel } from "../db/channels";
import { finishDelivery, finishMessage, insertDelivery, insertMessage } from "../db/messages";
import { pollTelegramUpdates } from "../hooks/telegram";
import { randomId, randomString } from "../lib/crypto";
import { badRequest, notFound, readJson, zodFields } from "./util";

export const channelsApi = new Hono<AppEnv>();

function catalogDefaults(kind: ChannelKind): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of CHANNEL_CATALOG[kind].fields) if (field.defaultValue !== undefined) out[field.key] = field.defaultValue;
  return out;
}

async function validateAndVerify(c: Context<AppEnv>, channel: StoredChannel, previous: Record<string, unknown> | null) {
  const parsed = channelConfigSchemas[channel.kind].safeParse(channel.config);
  if (!parsed.success) return badRequest(c, "Check the highlighted fields.", zodFields(parsed.error));
  channel.config = parsed.data as Record<string, unknown>;
  const adapter = adapters[channel.kind] as ChannelAdapter<ChannelKind>;
  if (adapter.verify) {
    const result = await adapter
      .verify({ env: c.env, channel: { id: channel.id, userId: channel.userId, name: channel.name, kind: channel.kind }, config: parsed.data, origin: c.get("origin") })
      .catch((error: unknown) => ({ ok: false, detail: `Could not reach ${CHANNEL_CATALOG[channel.kind].name}: ${String(error)}`, patch: undefined }));
    if (!result.ok) return badRequest(c, result.detail);
    channel.config = { ...channel.config, ...result.patch };
  }
  if (channel.kind === "telegram" && previous && previous.botId !== channel.config.botId) {
    channel.config = { ...channel.config, chatId: undefined, chatTitle: undefined, topicsChatId: undefined, topicsChatTitle: undefined };
    await c.env.DB.prepare("DELETE FROM topic_threads WHERE channel_id = ?").bind(channel.id).run();
  }
  const status = configStatus(channel.kind, channel.config);
  channel.status = status.status;
  channel.statusDetail = status.detail;
  await saveChannel(c.env, channel);
  return c.json(toChannelDTO(channel));
}

channelsApi.get("/", async (c) => c.json({ items: (await listChannels(c.env, c.get("user").id)).map(toChannelDTO) }));

channelsApi.post("/", async (c) => {
  const body = (await readJson(c)) as Partial<CreateChannelBody>;
  if (!isChannelKind(body.kind)) return badRequest(c, "Pick a channel type.");
  const kind = body.kind;
  const config = { ...catalogDefaults(kind), ...(body.config ?? {}) };
  if (kind === "gmail" && config.mode !== "app_password") return badRequest(c, "Use Connect with Google to add Gmail, or pick App password.");
  const channel: StoredChannel = {
    id: randomId("chn"),
    userId: c.get("user").id,
    kind,
    name: (body.name ?? "").trim().slice(0, 60) || CHANNEL_CATALOG[kind].name,
    enabled: true,
    status: "ready",
    statusDetail: null,
    config,
    lastUsedAt: null,
    lastError: null,
    createdAt: Date.now(),
  };
  return validateAndVerify(c, channel, null);
});

channelsApi.get("/:id", async (c) => {
  let channel = await getChannel(c.env, c.get("user").id, c.req.param("id"));
  if (!channel) return notFound(c, "Channel not found");
  if (channel.kind === "telegram" && !c.get("origin").startsWith("https://")) {
    await pollTelegramUpdates(c.env, channel);
    channel = (await getChannel(c.env, c.get("user").id, channel.id)) ?? channel;
  }
  return c.json(toChannelDTO(channel));
});

channelsApi.patch("/:id", async (c) => {
  const channel = await getChannel(c.env, c.get("user").id, c.req.param("id"));
  if (!channel) return notFound(c, "Channel not found");
  const body = (await readJson(c)) as UpdateChannelBody;
  if (typeof body.name === "string" && body.name.trim()) channel.name = body.name.trim().slice(0, 60);
  if (typeof body.enabled === "boolean") channel.enabled = body.enabled;
  if (!body.config) {
    await saveChannel(c.env, channel);
    return c.json(toChannelDTO(channel));
  }
  const previous = { ...channel.config };
  const secrets = new Set(secretFieldKeys(CHANNEL_CATALOG[channel.kind]));
  for (const [key, value] of Object.entries(body.config)) {
    if (secrets.has(key) && (value === "" || value === null || value === undefined)) continue;
    channel.config[key] = value;
  }
  return validateAndVerify(c, channel, previous);
});

channelsApi.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const channel = await getChannel(c.env, user.id, id);
  if (!channel) return notFound(c, "Channel not found");
  if (channel.kind === "telegram" && typeof channel.config.botToken === "string") {
    c.executionCtx.waitUntil(fetch(`https://api.telegram.org/bot${channel.config.botToken}/deleteWebhook`).catch(() => undefined));
  }
  await deleteChannel(c.env, user.id, id);
  return c.json({ ok: true });
});

channelsApi.post("/:id/test", async (c) => {
  const user = c.get("user");
  const channel = await getChannel(c.env, user.id, c.req.param("id"));
  if (!channel) return notFound(c, "Channel not found");
  const target: ChannelTarget = (await readJson(c)).target === "topic" ? "topic" : "main";
  const now = Date.now();
  const topic = target === "topic" ? { key: "beep-me test", name: "Beep Me test" } : null;
  const message: OutboundMessage = {
    id: randomId("msg"),
    title: "Test from Beep Me",
    body: `This is a test for ${channel.name}. If you can read it, this channel works.`,
    priority: "medium",
    topic,
    url: null,
    agent: { id: null, name: "Beep Me" },
    silent: false,
    appUrl: c.get("origin"),
    test: true,
    createdAt: now,
    attachments: [],
    options: [],
    expectReply: false,
    senderName: null,
  };
  message.appUrl = `${c.get("origin")}/?message=${message.id}`;
  await insertMessage(c.env.DB, {
    id: message.id, userId: user.id, agentId: null, agentName: "Beep Me", priority: "medium", requestedPriority: "medium", topic,
    title: message.title, body: message.body, url: null, dedupeHash: message.id, status: "pending", notes: [], quiet: false, source: "test", createdAt: now,
    attachments: [], options: [], expectReply: false, senderName: null,
  });
  const deliveryId = randomId("dlv");
  await insertDelivery(c.env.DB, {
    id: deliveryId, messageId: message.id, userId: user.id, agentId: null, channelId: channel.id, channelKind: channel.kind,
    channelName: channel.name, target, isSms: CHANNEL_CATALOG[channel.kind].isSms, createdAt: now,
  });
  const result = await sendToChannel(c.env, c.get("origin"), channel, target, message, deliveryId);
  const detail = result.detail ?? (result.ok ? "Sent." : "Send failed.");
  await finishDelivery(c.env.DB, deliveryId, result.ok ? "sent" : "failed", result.providerId ?? null, detail);
  await finishMessage(c.env.DB, message.id, result.ok ? "delivered" : "failed", [`Channel test for ${channel.name}.`], false);
  return c.json<TestResult>({ ok: result.ok, detail, messageId: message.id });
});

channelsApi.post("/:id/telegram/link", async (c) => {
  const user = c.get("user");
  const channel = await getChannel(c.env, user.id, c.req.param("id"));
  if (!channel || channel.kind !== "telegram") return notFound(c, "Telegram channel not found");
  const bot = channel.config.botUsername;
  if (typeof bot !== "string" || !bot) return badRequest(c, "Save a valid bot token first.");
  const purpose = (await readJson(c)).purpose === "topics" ? "topics" : "main";
  const code = randomString(24);
  const expiresAt = Date.now() + 15 * 60_000;
  await c.env.DB.prepare("INSERT INTO link_codes (code, user_id, channel_id, purpose, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(code, user.id, channel.id, purpose, expiresAt)
    .run();
  const url = purpose === "topics" ? `https://t.me/${bot}?startgroup=${code}&admin=manage_topics` : `https://t.me/${bot}?start=${code}`;
  return c.json<TelegramLink>({ url, code, expiresAt });
});
