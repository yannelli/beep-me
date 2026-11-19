import { clip, isHttpUrl } from "./http";
import { telegramHtml } from "./render";
import { TelegramApiError, tg, type TgForumTopic, type TgInlineButton, type TgInlineKeyboard, type TgMessage, type TgUser } from "./telegram-api";
import { TELEGRAM_CALLBACK, type ChannelAdapter, type OutboundMessage, type SendContext, type SendResult } from "./types";

type Ctx = SendContext<"telegram">;
type TopicAttempt = SendResult & { fallback?: boolean };

const LINK_DETAIL = "Open the bot in Telegram and press Start to link this chat.";
const MUTE_MINUTES = 60;
const CALLBACK_DATA_MAX_BYTES = 64;
const TOPIC_NAME_MAX = 128;
const THREAD_GONE = /thread not found|topic_deleted|topic_id_invalid|topic not found/i;

export const telegram: ChannelAdapter<"telegram"> = {
  kind: "telegram",

  async send(ctx, message) {
    const { config } = ctx;
    if (!config.chatId) return { ok: false, detail: LINK_DETAIL };
    const threadChat = config.privateTopics ? config.chatId : config.topicsChatId;
    if (ctx.target === "topic" && message.topic && threadChat) {
      const attempt = await sendToTopic(ctx, threadChat, message, message.topic);
      if (attempt.ok || !attempt.fallback) return stripFallback(attempt);
      const main = await deliver(config.botToken, messageParams(config.chatId, message));
      return main.ok ? { ...main, detail: `Sent to the main chat. Topic failed: ${attempt.detail}` } : main;
    }
    return deliver(config.botToken, messageParams(config.chatId, message));
  },

  async markRepeat(ctx, providerId, message, count) {
    const split = providerId.lastIndexOf(":");
    const messageId = Number(providerId.slice(split + 1));
    if (split <= 0 || !Number.isInteger(messageId)) return;
    const { text, ...rest } = messageParams(providerId.slice(0, split), message, null, `Repeated ×${count}`);
    try {
      await tg(ctx.config.botToken, "editMessageText", {
        chat_id: rest.chat_id,
        message_id: messageId,
        text,
        parse_mode: rest.parse_mode,
        link_preview_options: rest.link_preview_options,
        reply_markup: rest.reply_markup,
      });
    } catch (error) {
      if (!(error instanceof TelegramApiError)) throw error;
    }
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
        allowed_updates: ["message", "callback_query", "my_chat_member"],
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
  const first = await deliver(token, messageParams(chatId, message, threadId));
  if (first.ok || !reused || !THREAD_GONE.test(first.detail ?? "")) return first;
  await ctx.threads.delete(topic.key);
  const again = await createTopic(ctx, chatId, topic);
  if (!again.ok) return again;
  return deliver(token, messageParams(chatId, message, again.threadId));
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

function messageParams(chatId: string, message: OutboundMessage, threadId: string | null = null, footer = "") {
  return {
    chat_id: chatId,
    ...(threadId ? { message_thread_id: Number(threadId) } : {}),
    text: telegramHtml(message, footer),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    disable_notification: message.silent,
    reply_markup: keyboard(message),
  };
}

function keyboard(message: OutboundMessage): TgInlineKeyboard | undefined {
  const row: TgInlineButton[] = [];
  if (message.agent.id && !message.test) {
    const data = TELEGRAM_CALLBACK.muteAgent(message.agent.id, MUTE_MINUTES);
    if (new TextEncoder().encode(data).length <= CALLBACK_DATA_MAX_BYTES) {
      row.push({ text: clip(`Mute ${message.agent.name} 1h`, 64), callback_data: data });
    }
  }
  if (isHttpUrl(message.url)) row.push({ text: "Open link", url: message.url });
  return row.length > 0 ? { inline_keyboard: [row] } : undefined;
}

async function deliver(token: string, params: ReturnType<typeof messageParams>): Promise<SendResult> {
  try {
    const sent = await tg<TgMessage>(token, "sendMessage", params);
    return { ok: true, providerId: `${params.chat_id}:${sent.message_id}` };
  } catch (error) {
    return { ok: false, detail: errorDetail(error) };
  }
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
