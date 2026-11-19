import type { AttachmentKind } from "../../shared/api";
import type { ChannelConfig } from "../../shared/channel-configs";
import type { ChannelKind, ChannelTarget } from "../../shared/channels";
import type { Priority } from "../../shared/priority";

/** A file to send. `url` is public; `load()` returns the bytes for channels that upload files. */
export interface OutboundAttachment {
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number | null;
  url: string;
  load(): Promise<Uint8Array>;
}

/** One notification, already routed. Adapters render it for their channel. */
export interface OutboundMessage {
  id: string;
  title: string | null;
  body: string;
  priority: Priority;
  topic: { key: string; name: string } | null;
  url: string | null;
  /** Every rendering must show the agent name. */
  agent: { id: string | null; name: string };
  /** Quiet hours: deliver without sound where the channel supports it. */
  silent: boolean;
  /** Link to this message in the dashboard. */
  appUrl: string;
  /** True for the channel Test button. */
  test: boolean;
  createdAt: number;
  attachments: OutboundAttachment[];
  /** Choices to offer. Channels with buttons show buttons; others list them as "Reply 1 for ...". */
  options: string[];
  /** The agent waits for an answer. Channels can show a reply prompt. */
  expectReply: boolean;
  /** Optional display name from the agent, shown next to the agent name. Email uses it as the From name. */
  senderName: string | null;
}

/** A file that arrived with an interaction. `ref` is provider-specific, for example a Telegram file_id. */
export interface InboundMedia {
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number | null;
  ref: string;
}

/** Per-channel map from topic key to the provider's thread reference (Telegram message_thread_id, Discord thread id). */
export interface ThreadStore {
  get(topicKey: string): Promise<string | null>;
  set(topicKey: string, threadRef: string): Promise<void>;
  delete(topicKey: string): Promise<void>;
}

export interface ChannelRef<K extends ChannelKind> {
  id: string;
  userId: string;
  name: string;
  kind: K;
}

export interface SendContext<K extends ChannelKind> {
  env: Env;
  channel: ChannelRef<K>;
  config: ChannelConfig<K>;
  target: ChannelTarget;
  threads: ThreadStore;
  /** Stores server-managed config fields, for example a refreshed Gmail access token. */
  saveConfig(patch: Partial<ChannelConfig<K>>): Promise<void>;
  /** Delivery receipt URL for SMS providers. null on http origins (local dev). */
  statusCallbackUrl: string | null;
}

export interface SendResult {
  ok: boolean;
  /** Provider message id. Telegram uses "<chatId>:<messageId>". */
  providerId?: string;
  /** Short text for the delivery log. On failure, the provider's own error text. */
  detail?: string;
}

export interface VerifyContext<K extends ChannelKind> {
  env: Env;
  channel: ChannelRef<K>;
  config: ChannelConfig<K>;
  /** Public origin of this deployment, for example https://beep-me.example.workers.dev */
  origin: string;
}

export interface VerifyResult {
  ok: boolean;
  detail: string;
  /** Server-managed fields to store, for example the Telegram bot username. */
  patch?: Record<string, unknown>;
}

export interface ChannelAdapter<K extends ChannelKind> {
  kind: K;
  send(ctx: SendContext<K>, message: OutboundMessage): Promise<SendResult>;
  /** Runs when the channel is created or its config changes. Checks credentials without sending a message. */
  verify?(ctx: VerifyContext<K>): Promise<VerifyResult>;
  /** Runs when identical messages collapse into an earlier one, to show the repeat count. */
  markRepeat?(ctx: SendContext<K>, providerId: string, message: OutboundMessage, count: number): Promise<void>;
  /** Streams an inbound file to the agent or dashboard. `ref` is the value stored in InboundMedia. */
  fetchMedia?(ctx: SendContext<K>, ref: string): Promise<Response>;
  /** Runs after an agent reads interactions from this channel, with their providerRef values. Telegram reacts to the answer. */
  markRead?(ctx: SendContext<K>, refs: string[]): Promise<void>;
}

export type AdapterRegistry = { [K in ChannelKind]: ChannelAdapter<K> };

/** Telegram inline buttons send these callback_data strings. The webhook handler parses them. */
export const TELEGRAM_CALLBACK = {
  muteAgent: (agentId: string, minutes: number) => `mute:${agentId}:${minutes}`,
  pauseAll: (minutes: number) => `pause:${minutes}`,
  answer: (messageId: string, index: number) => `ans:${messageId}:${index}`,
} as const;
