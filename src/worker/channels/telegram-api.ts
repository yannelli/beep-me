import { http, isRecord } from "./http";

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

export interface TgMessage {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
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
}

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

/** Calls a Bot API method with JSON params. Throws TelegramApiError on any failure; the token never appears in the error. */
export async function tg<T>(token: string, method: string, params: object = {}, options: { timeoutMs?: number } = {}): Promise<T> {
  const response = await http(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    timeoutMs: options.timeoutMs,
  });
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

export function getUpdates(token: string, params: TgGetUpdatesParams = {}): Promise<TgUpdate[]> {
  const timeoutMs = ((params.timeout ?? 0) + 10) * 1000;
  return tg<TgUpdate[]>(token, "getUpdates", params, { timeoutMs });
}
