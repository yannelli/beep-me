import type { MatchedBy } from "../../shared/api";
import type { StoredChannel } from "../db/channels";
import { findMessageByProviderId, latestMessageForChannel, recordInteraction, type MatchedMessage } from "../db/interactions";
import { TELEGRAM_CAPTION_LIMIT, TELEGRAM_LIMIT } from "./render";
import { TelegramApiError, tg, type TgCallbackQuery, type TgChat, type TgEntity, type TgMessage, type TgMessageReaction, type TgReaction, type TgUser } from "./telegram-api";
import { inboundMedia } from "./telegram-media";

const MATCH_WINDOW_MS = 24 * 3_600_000;
const COMMAND = /^\/[a-z0-9_]+(@\w+)?(\s|$)/i;

function senderName(user?: TgUser, chat?: TgChat): string | null {
  if (user) return [user.first_name, user.last_name].filter(Boolean).join(" ") || (user.username ? `@${user.username}` : null);
  return chat?.title ?? null;
}

/** A reply to a Beep Me message matches that message. Anything else matches the newest message in the same chat or topic thread. */
async function matchMessage(db: D1Database, channel: StoredChannel, message: TgMessage): Promise<{ found: MatchedMessage; by: MatchedBy } | null> {
  const chatId = String(message.chat.id);
  const parent = message.reply_to_message;
  if (parent && !parent.forum_topic_created) {
    const found = await findMessageByProviderId(db, channel.id, `${chatId}:${parent.message_id}`);
    if (found) return { found, by: "reply" };
  }
  const latest = await latestInChat(db, channel, message, chatId);
  return latest ? { found: latest, by: "latest" } : null;
}

async function latestInChat(db: D1Database, channel: StoredChannel, message: TgMessage, chatId: string): Promise<MatchedMessage | null> {
  const scope = { since: Date.now() - MATCH_WINDOW_MS, preferAwaiting: true, providerPrefix: `${chatId}:` };
  const threadId = message.is_topic_message ? message.message_thread_id : undefined;
  if (threadId === undefined) return latestMessageForChannel(db, channel.id, { ...scope, target: "main" });
  const topic = await db
    .prepare("SELECT topic_key FROM topic_threads WHERE channel_id = ? AND thread_ref = ?")
    .bind(channel.id, String(threadId))
    .first<{ topic_key: string }>();
  return topic ? latestMessageForChannel(db, channel.id, { ...scope, target: "topic", topicKey: topic.topic_key }) : null;
}

/** "2" or the option's label, when the matched message offered options. */
function optionFromText(text: string, options: string[]): number | null {
  const number = /^\d{1,2}$/.test(text) ? Number(text) - 1 : -1;
  if (number >= 0 && number < options.length) return number;
  const index = options.findIndex((option) => option.toLowerCase() === text.toLowerCase());
  return index >= 0 ? index : null;
}

/** Records text, files, and voice notes from a linked chat. Commands and messages from bots are skipped. */
export async function recordTelegramMessage(env: Env, channel: StoredChannel, message: TgMessage): Promise<void> {
  const text = (message.text ?? message.caption ?? "").trim();
  const media = inboundMedia(message);
  if (message.from?.is_bot || COMMAND.test(text) || (!text && !media.length)) return;
  const matched = await matchMessage(env.DB, channel, message);
  const option = matched && text && !media.length ? optionFromText(text, matched.found.options) : null;
  await recordInteraction(env.DB, {
    userId: channel.userId,
    channelId: channel.id,
    channelKind: "telegram",
    messageId: matched?.found.messageId ?? null,
    matchedBy: matched?.by ?? null,
    kind: option === null ? "reply" : "choice",
    text: text || null,
    optionIndex: option,
    media,
    sender: senderName(message.from, message.sender_chat),
    providerRef: `msg:${message.chat.id}:${message.message_id}`,
  });
}

/** Records an option button tap and returns the text for the callback answer. */
export async function recordTelegramChoice(env: Env, channel: StoredChannel, query: TgCallbackQuery, messageId: string, index: number): Promise<string> {
  const source = query.message;
  const found = source ? await findMessageByProviderId(env.DB, channel.id, `${source.chat.id}:${source.message_id}`) : null;
  const label = found?.messageId === messageId ? found.options[index] : undefined;
  if (!source || !label) return "This question is no longer open.";
  await recordInteraction(env.DB, {
    userId: channel.userId,
    channelId: channel.id,
    channelKind: "telegram",
    messageId,
    matchedBy: "button",
    kind: "choice",
    text: null,
    optionIndex: index,
    media: [],
    sender: senderName(query.from),
    providerRef: `cb:${query.id}`,
  });
  await showChoice(String(channel.config.botToken ?? ""), source, label);
  return `Sent: ${label}`;
}

/** Adds "✅ <label>" under the message and removes the option buttons. Mute and Open link stay. */
async function showChoice(token: string, message: TgMessage, label: string): Promise<void> {
  const rows = (message.reply_markup?.inline_keyboard ?? []).map((row) => row.filter((button) => !button.callback_data?.startsWith("ans:")));
  const target = { chat_id: message.chat.id, message_id: message.message_id, reply_markup: { inline_keyboard: rows.filter((row) => row.length) } };
  const isCaption = message.text === undefined;
  const original = message.text ?? message.caption ?? "";
  const prefix = `${original}\n\n✅ `;
  const updated = prefix + label;
  const entities: TgEntity[] = [...((isCaption ? message.caption_entities : message.entities) ?? []), { type: "bold", offset: prefix.length, length: label.length }];
  const call = async (method: string, params: object) => {
    try {
      await tg(token, method, params);
    } catch (error) {
      if (!(error instanceof TelegramApiError)) throw error;
    }
  };
  if (updated.length > (isCaption ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_LIMIT)) await call("editMessageReplyMarkup", target);
  else if (isCaption) await call("editMessageCaption", { ...target, caption: updated, caption_entities: entities });
  else await call("editMessageText", { ...target, text: updated, entities, link_preview_options: { is_disabled: true } });
}

function reactionText(reaction: TgReaction): string {
  if (reaction.type === "emoji") return reaction.emoji;
  return reaction.type === "paid" ? "⭐" : "custom emoji";
}

/** Records emoji added to a Beep Me message. Removed reactions and reactions on other messages are skipped. */
export async function recordTelegramReaction(env: Env, channel: StoredChannel, update: TgMessageReaction): Promise<void> {
  const before = new Set(update.old_reaction.map(reactionText));
  const added = update.new_reaction.map(reactionText).filter((text) => !before.has(text));
  if (!added.length) return;
  const found = await findMessageByProviderId(env.DB, channel.id, `${update.chat.id}:${update.message_id}`);
  if (!found) return;
  const text = added.join(" ");
  const who = update.user?.id ?? update.actor_chat?.id ?? "";
  await recordInteraction(env.DB, {
    userId: channel.userId,
    channelId: channel.id,
    channelKind: "telegram",
    messageId: found.messageId,
    matchedBy: "reaction",
    kind: "reaction",
    text,
    optionIndex: null,
    media: [],
    sender: senderName(update.user, update.actor_chat),
    providerRef: `rx:${update.chat.id}:${update.message_id}:${who}:${update.date}:${text}`,
  });
}
