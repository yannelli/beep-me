import { clip, isHttpUrl } from "./http";
import { TELEGRAM_CAPTION_LIMIT, telegramHtml } from "./render";
import {
  TELEGRAM_UPDATES,
  TelegramApiError,
  tg,
  type TgForceReply,
  type TgForumTopic,
  type TgInlineButton,
  type TgInlineKeyboard,
  type TgMessage,
  type TgUser,
} from "./telegram-api";
import { failureText, fetchTelegramFile, loadFile, sendFile, sendFiles } from "./telegram-media";
import { TELEGRAM_CALLBACK, type ChannelAdapter, type OutboundMessage, type SendContext, type SendResult } from "./types";

type Ctx = SendContext<"telegram">;
type TopicAttempt = SendResult & { fallback?: boolean };

const LINK_DETAIL = "Open the bot in Telegram and press Start to link this chat.";
const MUTE_MINUTES = 60;
const CALLBACK_DATA_MAX_BYTES = 64;
const TOPIC_NAME_MAX = 128;
const THREAD_GONE = /thread not found|topic_deleted|topic_id_invalid|topic not found/i;
const READ_REACTION = "👀";
const SHORT_OPTION = 16;

export const telegram: ChannelAdapter<"telegram"> = {
  kind: "telegram",

  async send(ctx, message) {
    const { config } = ctx;
    if (!config.chatId) return { ok: false, detail: LINK_DETAIL };
    const threadChat = config.privateTopics ? config.chatId : config.topicsChatId;
    if (ctx.target === "topic" && message.topic && threadChat) {
      const attempt = await sendToTopic(ctx, threadChat, message, message.topic);
      if (attempt.ok || !attempt.fallback) return stripFallback(attempt);
      const main = await deliver(config.botToken, config.chatId, message, null);
      return main.ok ? { ...main, detail: `Sent to the main chat. Topic failed: ${attempt.detail}` } : main;
    }
    return deliver(config.botToken, config.chatId, message, null);
  },

  async markRepeat(ctx, providerId, message, count) {
    const split = providerId.lastIndexOf(":");
    const messageId = Number(providerId.slice(split + 1));
    if (split <= 0 || !Number.isInteger(messageId)) return;
    const footer = `Repeated ×${count}`;
    const target = { chat_id: providerId.slice(0, split), message_id: messageId, parse_mode: "HTML", reply_markup: inlineKeyboard(message) };
    try {
      await tg(ctx.config.botToken, "editMessageText", { ...target, text: telegramHtml(message, footer), link_preview_options: { is_disabled: true } });
    } catch (error) {
      if (!(error instanceof TelegramApiError)) throw error;
      if (!/no text in the message/i.test(error.description)) return;
      const caption = telegramHtml(message, footer, TELEGRAM_CAPTION_LIMIT);
      await tg(ctx.config.botToken, "editMessageCaption", { ...target, caption }).catch(ignoreTelegram);
    }
  },

  fetchMedia(ctx, ref) {
    return fetchTelegramFile(ctx.config.botToken, ref);
  },

  async markRead(ctx, refs) {
    await Promise.all(
      refs.map(async (ref) => {
        const match = /^msg:(-?\d+):(\d+)$/.exec(ref);
        if (!match) return;
        const reaction = [{ type: "emoji", emoji: READ_REACTION }];
        await tg(ctx.config.botToken, "setMessageReaction", { chat_id: match[1], message_id: Number(match[2]), reaction }).catch(ignoreTelegram);
      }),
    );
  },

  async verify(ctx) {
    const token = ctx.config.botToken;
    let me: TgUser;
    try {
      me = await tg<TgUser>(token, "getMe");
    } catch (error) {
      return { ok: false, detail: errorDetail(error) };
    }
    const bot = me.username ? `@${me.username}` : `bot ${me.id}`;
    const patch: Record<string, unknown> = { botId: me.id, botUsername: me.username, privateTopics: me.has_topics_enabled === true };
    const origin = ctx.origin.replace(/\/+$/, "");
    if (!origin.startsWith("https://")) {
      return { ok: true, detail: `Connected to ${bot}. Webhook not set because ${origin} is not https.`, patch };
    }
    const secret = ctx.config.webhookSecret ?? randomToken();
    try {
      await tg<boolean>(token, "setWebhook", {
        url: `${origin}/hooks/telegram/${ctx.channel.id}`,
        secret_token: secret,
        allowed_updates: TELEGRAM_UPDATES,
        drop_pending_updates: true,
      });
    } catch (error) {
      return { ok: false, detail: `Connected to ${bot}, but setWebhook failed: ${errorDetail(error)}`, patch };
    }
    if (!ctx.config.webhookSecret) patch.webhookSecret = secret;
    return { ok: true, detail: `Connected to ${bot}. Webhook set.`, patch };
  },
};

async function sendToTopic(ctx: Ctx, chatId: string, message: OutboundMessage, topic: { key: string; name: string }): Promise<TopicAttempt> {
  const token = ctx.config.botToken;
  let threadId = await ctx.threads.get(topic.key);
  const reused = threadId !== null;
  if (!threadId) {
    const created = await createTopic(ctx, chatId, topic);
    if (!created.ok) return created;
    threadId = created.threadId;
  }
  const first = await deliver(token, chatId, message, threadId);
  if (first.ok || !reused || !THREAD_GONE.test(first.detail ?? "")) return first;
  await ctx.threads.delete(topic.key);
  const again = await createTopic(ctx, chatId, topic);
  if (!again.ok) return again;
  return deliver(token, chatId, message, again.threadId);
}

async function createTopic(
  ctx: Ctx,
  chatId: string,
  topic: { key: string; name: string },
): Promise<{ ok: true; threadId: string } | { ok: false; fallback: true; detail: string }> {
  try {
    const name = clip(topic.name.trim() || topic.key, TOPIC_NAME_MAX);
    const created = await tg<TgForumTopic>(ctx.config.botToken, "createForumTopic", { chat_id: chatId, name });
    const threadId = String(created.message_thread_id);
    await ctx.threads.set(topic.key, threadId);
    return { ok: true, threadId };
  } catch (error) {
    return { ok: false, fallback: true, detail: `createForumTopic: ${errorDetail(error)}` };
  }
}

/** Option buttons first, then Mute and Open link. */
function inlineKeyboard(message: OutboundMessage): TgInlineKeyboard | undefined {
  const perRow = message.options.every((option) => option.length <= SHORT_OPTION) ? 2 : 1;
  const rows: TgInlineButton[][] = [];
  message.options.forEach((option, index) => {
    const button = { text: option, callback_data: TELEGRAM_CALLBACK.answer(message.id, index) };
    if (index % perRow === 0) rows.push([button]);
    else rows.at(-1)!.push(button);
  });
  const row: TgInlineButton[] = [];
  if (message.agent.id && !message.test) {
    const data = TELEGRAM_CALLBACK.muteAgent(message.agent.id, MUTE_MINUTES);
    if (new TextEncoder().encode(data).length <= CALLBACK_DATA_MAX_BYTES) {
      row.push({ text: clip(`Mute ${message.agent.name} 1h`, 64), callback_data: data });
    }
  }
  if (isHttpUrl(message.url)) row.push({ text: "Open link", url: message.url });
  if (row.length) rows.push(row);
  return rows.length > 0 ? { inline_keyboard: rows } : undefined;
}

/** An open question opens the reply field. Questions with options keep the buttons in view instead. */
function replyMarkup(message: OutboundMessage): TgInlineKeyboard | TgForceReply | undefined {
  const keyboard = inlineKeyboard(message);
  if (!message.expectReply || message.options.length) return keyboard;
  return keyboard ? { ...keyboard, force_reply: true } : { force_reply: true, input_field_placeholder: clip(`Reply to ${message.agent.name}`, 64) };
}

/** One file whose caption fits goes as a captioned file. Otherwise the files go first and the text with the buttons replies to them. */
async function deliver(token: string, chatId: string, message: OutboundMessage, threadId: string | null): Promise<SendResult> {
  const base = { chat_id: chatId, ...(threadId ? { message_thread_id: Number(threadId) } : {}) };
  const shown = { ...base, parse_mode: "HTML", disable_notification: message.silent, reply_markup: replyMarkup(message) };
  const html = telegramHtml(message);
  const failures: string[] = [];
  let replyTo: number | null = null;
  const [only] = message.attachments;
  if (only && message.attachments.length === 1 && telegramHtml(message, "", TELEGRAM_CAPTION_LIMIT) === html) {
    try {
      const sent = await sendFile(token, { ...shown, caption: html }, await loadFile(only));
      return { ok: true, providerId: `${chatId}:${sent.message_id}` };
    } catch (error) {
      failures.push(`${only.name}: ${failureText(error)}`);
    }
  } else if (message.attachments.length) {
    const files = await sendFiles(token, { ...base, disable_notification: true }, message.attachments);
    failures.push(...files.failures);
    replyTo = files.firstMessageId;
  }
  try {
    const sent = await tg<TgMessage>(token, "sendMessage", {
      ...shown,
      text: html,
      link_preview_options: { is_disabled: true },
      ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}),
    });
    const detail = failures.length ? { detail: clip(`Files not sent: ${failures.join("; ")}`) } : {};
    return { ok: true, providerId: `${chatId}:${sent.message_id}`, ...detail };
  } catch (error) {
    return { ok: false, detail: errorDetail(error) };
  }
}

function ignoreTelegram(error: unknown): void {
  if (!(error instanceof TelegramApiError)) throw error;
}

function errorDetail(error: unknown): string {
  if (error instanceof TelegramApiError) return error.message;
  throw error;
}

function stripFallback({ fallback: _fallback, ...result }: TopicAttempt): SendResult {
  return result;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
