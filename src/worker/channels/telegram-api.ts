import { http, isRecord, type HttpInit } from "./http";

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  /** getMe only: forum topic mode is on in private chats. */
  has_topics_enabled?: boolean;
  allows_users_to_create_topics?: boolean;
}

export interface TgChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  is_forum?: boolean;
}

export interface TgEntity {
  type: string;
  offset: number;
  length: number;
}

export interface TgFileBase {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
}

export interface TgPhotoSize extends TgFileBase {
  width: number;
  height: number;
}

export interface TgDocument extends TgFileBase {
  file_name?: string;
  mime_type?: string;
}

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TgUser;
  sender_chat?: TgChat;
  chat: TgChat;
  date: number;
  text?: string;
  entities?: TgEntity[];
  caption?: string;
  caption_entities?: TgEntity[];
  reply_to_message?: TgMessage;
  forum_topic_created?: object;
  photo?: TgPhotoSize[];
  document?: TgDocument;
  voice?: TgDocument;
  audio?: TgDocument;
  video?: TgDocument;
  video_note?: TgFileBase;
  animation?: TgDocument;
  reply_markup?: TgInlineKeyboard;
}

export type TgReaction = { type: "emoji"; emoji: string } | { type: "custom_emoji"; custom_emoji_id: string } | { type: "paid" };

export interface TgMessageReaction {
  chat: TgChat;
  message_id: number;
  user?: TgUser;
  actor_chat?: TgChat;
  date: number;
  old_reaction: TgReaction[];
  new_reaction: TgReaction[];
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  inline_message_id?: string;
  chat_instance: string;
  data?: string;
}

export interface TgChatMember {
  status: "creator" | "administrator" | "member" | "restricted" | "left" | "kicked";
  user: TgUser;
  can_manage_topics?: boolean;
}

export interface TgChatMemberUpdated {
  chat: TgChat;
  from: TgUser;
  date: number;
  old_chat_member: TgChatMember;
  new_chat_member: TgChatMember;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  my_chat_member?: TgChatMemberUpdated;
  message_reaction?: TgMessageReaction;
}

/** Every update type the webhook handler reads. setWebhook and getUpdates both send this list. */
export const TELEGRAM_UPDATES = ["message", "callback_query", "my_chat_member", "message_reaction"];

export interface TgForumTopic {
  message_thread_id: number;
  name: string;
  icon_color: number;
}

export interface TgInlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgInlineKeyboard {
  inline_keyboard: TgInlineButton[][];
  /** Bot API 10.3: opens the reply field as well. Telegram does not let an edit change it. */
  force_reply?: boolean;
}

export interface TgForceReply {
  force_reply: true;
  input_field_placeholder?: string;
}

/** getUpdates params. Keep `timeout` (long poll, seconds) under the request timeout passed to tg(). */
export interface TgGetUpdatesParams {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowed_updates?: string[];
}

export class TelegramApiError extends Error {
  readonly code: number;
  readonly description: string;
  readonly retryAfter?: number;

  constructor(code: number, description: string, retryAfter?: number) {
    super(`Telegram ${code}: ${description}`);
    this.name = "TelegramApiError";
    this.code = code;
    this.description = description;
    this.retryAfter = retryAfter;
  }
}

const TELEGRAM_API = "https://api.telegram.org";

/** Calls a Bot API method with JSON params. Throws TelegramApiError on any failure; the token never appears in the error. */
export function tg<T>(token: string, method: string, params: object = {}, options: { timeoutMs?: number } = {}): Promise<T> {
  return call<T>(token, method, { headers: { "content-type": "application/json" }, body: JSON.stringify(params), timeoutMs: options.timeoutMs });
}

/** Calls a Bot API method with a multipart body, for file uploads. */
export function tgForm<T>(token: string, method: string, form: FormData): Promise<T> {
  return call<T>(token, method, { body: form, timeoutMs: 60_000 });
}

async function call<T>(token: string, method: string, init: HttpInit): Promise<T> {
  const response = await http(`${TELEGRAM_API}/bot${token}/${method}`, { method: "POST", ...init });
  const json = response.json;
  if (isRecord(json) && json.ok === true) return json.result as T;
  if (isRecord(json) && typeof json.description === "string") {
    const parameters = isRecord(json.parameters) ? json.parameters : {};
    const retryAfter = typeof parameters.retry_after === "number" ? parameters.retry_after : undefined;
    const code = typeof json.error_code === "number" ? json.error_code : response.status;
    throw new TelegramApiError(code, json.description, retryAfter);
  }
  throw new TelegramApiError(response.status, response.status === 0 ? response.text : `HTTP ${response.status}`);
}

/** Download URL for a getFile result. It holds the bot token, so it must not reach logs or clients. */
export function fileDownloadUrl(token: string, filePath: string): string {
  return `${TELEGRAM_API}/file/bot${token}/${filePath}`;
}

export function getUpdates(token: string, params: TgGetUpdatesParams = {}): Promise<TgUpdate[]> {
  const timeoutMs = ((params.timeout ?? 0) + 10) * 1000;
  return tg<TgUpdate[]>(token, "getUpdates", params, { timeoutMs });
}
