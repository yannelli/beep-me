import { Hono } from "hono";
import type { AppEnv } from "../auth/session";
import { TELEGRAM_UPDATES, getUpdates, tg, type TgCallbackQuery, type TgMessage, type TgUpdate } from "../channels/telegram-api";
import { recordTelegramChoice, recordTelegramMessage, recordTelegramReaction } from "../channels/telegram-inbound";
import { getAgent, updateAgent } from "../db/agents";
import { configStatus, getChannel, listChannels, saveChannel, type StoredChannel } from "../db/channels";
import { getUser, saveSettings } from "../db/users";
import { timingSafeEqual } from "../lib/crypto";

export const telegramHook = new Hono<AppEnv>();

telegramHook.post("/:channelId", async (c) => {
  const channel = await getChannel(c.env, null, c.req.param("channelId"));
  const secret = channel?.config.webhookSecret;
  const given = c.req.header("x-telegram-bot-api-secret-token") ?? "";
  if (!channel || channel.kind !== "telegram" || typeof secret !== "string" || !timingSafeEqual(secret, given)) {
    return c.json({ ok: false }, 403);
  }
  const update = await c.req.json<TgUpdate>();
  c.executionCtx.waitUntil(handleTelegramUpdate(c.env, channel, update).catch((error: unknown) => console.error("telegram update failed", error)));
  return c.json({ ok: true });
});

function botToken(channel: StoredChannel): string {
  return String(channel.config.botToken ?? "");
}

async function reply(channel: StoredChannel, chatId: number | string, text: string, threadId?: number): Promise<void> {
  await tg(botToken(channel), "sendMessage", { chat_id: chatId, text, parse_mode: "HTML", message_thread_id: threadId }).catch(() => undefined);
}

function chatName(message: TgMessage): string {
  const chat = message.chat;
  return chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(" ") || (chat.username ? `@${chat.username}` : "Telegram chat"));
}

async function linkChat(env: Env, channel: StoredChannel, message: TgMessage, code: string): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM link_codes WHERE code = ? AND channel_id = ? AND expires_at > ?")
    .bind(code, channel.id, Date.now())
    .first<{ purpose: string }>();
  if (!row) {
    await reply(channel, message.chat.id, "This link expired. Open Beep Me and press <b>Open Telegram</b> again.");
    return;
  }
  if (row.purpose === "topics") {
    if (message.chat.type !== "supergroup" || !message.chat.is_forum) {
      await reply(channel, message.chat.id, "Turn on <b>Topics</b> in the settings of this group. Then open the link from Beep Me again.");
      return;
    }
    channel.config = { ...channel.config, topicsChatId: String(message.chat.id), topicsChatTitle: chatName(message) };
    await reply(channel, message.chat.id, "✅ Beep Me will create a topic here for each new subject.");
  } else {
    channel.config = { ...channel.config, chatId: String(message.chat.id), chatTitle: chatName(message) };
    const topics = channel.config.privateTopics === true ? " Each topic gets its own thread in this chat." : "";
    await reply(channel, message.chat.id, `✅ Connected to Beep Me. Medium messages arrive here.${topics}`);
  }
  const status = configStatus("telegram", channel.config);
  channel.status = status.status;
  channel.statusDetail = status.detail;
  await saveChannel(env, channel);
  await env.DB.prepare("DELETE FROM link_codes WHERE code = ?").bind(code).run();
}

function isLinkedChat(channel: StoredChannel, chatId: number | undefined): boolean {
  const id = String(chatId ?? "");
  return id !== "" && (id === channel.config.chatId || id === channel.config.topicsChatId);
}

async function handleCallback(env: Env, channel: StoredChannel, query: TgCallbackQuery): Promise<void> {
  const answer = (text: string) => tg(botToken(channel), "answerCallbackQuery", { callback_query_id: query.id, text }).catch(() => undefined);
  if (!isLinkedChat(channel, query.message?.chat.id)) return void (await answer("This chat is not linked to Beep Me."));
  const [action, first, second] = (query.data ?? "").split(":");
  if (action === "ans" && first) return void (await answer(await recordTelegramChoice(env, channel, query, first, Number(second))));
  if (action === "mute" && first) {
    const minutes = Math.min(Number(second) || 60, 7 * 1440);
    const agent = await getAgent(env.DB, first, channel.userId);
    if (!agent) return void (await answer("Agent not found."));
    await updateAgent(env.DB, channel.userId, agent.id, { mutedUntil: Date.now() + minutes * 60_000 });
    return void (await answer(`Muted ${agent.name} for ${minutes >= 60 ? `${minutes / 60} h` : `${minutes} min`}.`));
  }
  if (action === "pause" && first) {
    const user = await getUser(env.DB, channel.userId);
    if (!user) return;
    await saveSettings(env.DB, user.id, { ...user.settings, pausedUntil: Date.now() + Math.min(Number(first) || 60, 7 * 1440) * 60_000 });
    return void (await answer("Paused all notifications."));
  }
  await answer("Unknown action.");
}

export async function handleTelegramUpdate(env: Env, channel: StoredChannel, update: TgUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(env, channel, update.callback_query);
  const reaction = update.message_reaction;
  if (reaction) return isLinkedChat(channel, reaction.chat.id) ? recordTelegramReaction(env, channel, reaction) : undefined;
  const removed = update.my_chat_member;
  if (removed && ["left", "kicked"].includes(removed.new_chat_member.status) && String(removed.chat.id) === channel.config.topicsChatId) {
    channel.config = { ...channel.config, topicsChatId: undefined, topicsChatTitle: undefined };
    await saveChannel(env, channel);
    return;
  }
  const message = update.message;
  if (!message) return;
  const text = message.text?.trim() ?? "";
  if (!text.startsWith("/start")) {
    if (isLinkedChat(channel, message.chat.id)) await recordTelegramMessage(env, channel, message);
    return;
  }
  const code = text.split(/\s+/)[1];
  if (code) return linkChat(env, channel, message, code);
  if (!isLinkedChat(channel, message.chat.id)) {
    await reply(channel, message.chat.id, "Open Beep Me and press <b>Open Telegram</b> to link this chat.");
  }
}

/** Local development has no public webhook URL, so Beep Me reads updates with getUpdates: links, answers, and button taps. */
export async function pollTelegramUpdates(env: Env, channel: StoredChannel): Promise<void> {
  const token = botToken(channel);
  const updates = await getUpdates(token, { timeout: 0, allowed_updates: TELEGRAM_UPDATES }).catch(() => []);
  for (const update of updates) {
    await handleTelegramUpdate(env, channel, update).catch((error: unknown) => console.error("telegram update failed", error));
  }
  const last = updates.at(-1);
  if (last) await getUpdates(token, { offset: last.update_id + 1, timeout: 0 }).catch(() => undefined);
}

/** Polls the Telegram channels of the agent's owner. Used when an agent reads replies on an http origin. */
export async function pollTelegramForAgent(env: Env, agentId: string): Promise<void> {
  const agent = await getAgent(env.DB, agentId);
  if (!agent) return;
  const channels = await listChannels(env, agent.userId);
  await Promise.all(channels.filter((channel) => channel.kind === "telegram" && channel.enabled).map((channel) => pollTelegramUpdates(env, channel)));
}
