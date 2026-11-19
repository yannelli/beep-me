// Dashboard API types. The route table is in docs/api.md.
import type { ChannelKind, ChannelTarget } from "./channels";
import type { Priority } from "./priority";
import type { FallbackTrigger, UserSettings } from "./settings";

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
  /** What the change would do, sent with a 409 when a setup change needs confirm: true. */
  preview?: unknown;
}

export interface SessionResponse {
  user: UserDTO | null;
  setup: {
    googleConfigured: boolean;
    devLogin: boolean;
    /** The redirect URI to register in Google Cloud for this deployment. */
    googleRedirectUri: string;
  };
}

export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface MeResponse {
  user: UserDTO;
  settings: UserSettings;
  /** Absolute MCP endpoint, for example https://beep-me.example.workers.dev/mcp */
  mcpUrl: string;
  /** Absolute REST endpoint for curl and scripts. */
  notifyUrl: string;
  appUrl: string;
  counts: { channels: number; agents: number; messages: number };
  quietNow: boolean;
  gmailOAuthAvailable: boolean;
}

export type ChannelStatus = "ready" | "needs_setup" | "error";

export interface SecretState {
  set: boolean;
  /** The last 4 characters of the stored secret. */
  hint: string | null;
}

export interface ChannelDTO {
  id: string;
  kind: ChannelKind;
  name: string;
  enabled: boolean;
  status: ChannelStatus;
  statusDetail: string | null;
  /** Non-secret form values. Secret fields are in `secrets`. */
  config: Record<string, string | number | boolean | null>;
  secrets: Record<string, SecretState>;
  /** Targets this channel can deliver to right now. */
  targets: ChannelTarget[];
  telegram: TelegramInfo | null;
  lastUsedAt: number | null;
  lastError: string | null;
  createdAt: number;
}

export interface TelegramInfo {
  botUsername: string | null;
  chatLinked: boolean;
  chatTitle: string | null;
  /** "private": topics live in the bot chat. "group": topics live in a forum group. "off": topics go to the main chat. */
  topicsMode: "private" | "group" | "off";
  topicsChatTitle: string | null;
}

export interface CreateChannelBody {
  kind: ChannelKind;
  name?: string;
  config: Record<string, unknown>;
}

export interface UpdateChannelBody {
  name?: string;
  enabled?: boolean;
  /** Merged into the stored config. Omitted or empty secret fields keep their stored value. */
  config?: Record<string, unknown>;
}

export interface TestResult {
  ok: boolean;
  detail: string;
  messageId: string;
}

export interface TelegramLink {
  /** https://t.me/<bot>?start=<code> or ?startgroup=<code>&admin=manage_topics */
  url: string;
  code: string;
  expiresAt: number;
}

export type AgentKind = "oauth" | "token";
export type AgentStatus = "active" | "revoked";

export interface AgentDTO {
  id: string;
  name: string;
  kind: AgentKind;
  /** OAuth client name, for example "Claude" or "Claude Code". */
  clientName: string | null;
  tokenHint: string | null;
  maxPriority: Priority;
  /** null means every channel. */
  channelIds: string[] | null;
  smsPerHour: number | null;
  messagesPerHour: number | null;
  status: AgentStatus;
  mutedUntil: number | null;
  lastSeenAt: number | null;
  lastUserAgent: string | null;
  createdAt: number;
  revokedAt: number | null;
  sent24h: number;
}

export interface CreateAgentBody {
  name: string;
  maxPriority?: Priority;
  channelIds?: string[] | null;
}

export interface UpdateAgentBody {
  name?: string;
  maxPriority?: Priority;
  channelIds?: string[] | null;
  smsPerHour?: number | null;
  messagesPerHour?: number | null;
  /** Epoch ms, or null to unmute. */
  mutedUntil?: number | null;
}

export type AttachmentKind = "image" | "audio" | "video" | "file";

export interface AttachmentDTO {
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number | null;
  /** Public URL. Uploaded files live at /media/<id>/<name> for 7 days. */
  url: string;
}

/** reply: free text. choice: a button or numbered option. reaction: an emoji on the message. vote: a poll answer. */
export type InteractionKind = "reply" | "choice" | "reaction" | "vote";

/** How Beep Me tied an answer to a message. latest is a guess: the newest message on that chat that waited for an answer. */
export type MatchedBy = "reply" | "button" | "reaction" | "latest" | "address" | "dashboard";

export interface InteractionMediaDTO {
  kind: AttachmentKind;
  name: string;
  mime: string;
  size: number | null;
  /** Authenticated proxy: /api/media/<id>/<index> for the dashboard, <origin>/v1/media/<id>/<index> for agents. */
  url: string;
}

export interface InteractionDTO {
  id: string;
  messageId: string | null;
  agentId: string | null;
  channelId: string;
  channelKind: ChannelKind;
  /** null when the channel was deleted, or when the answer came from the dashboard (matchedBy "dashboard"). */
  channelName: string | null;
  kind: InteractionKind;
  /** null when Beep Me could not tie the answer to a message. */
  matchedBy: MatchedBy | null;
  text: string | null;
  option: { index: number; label: string } | null;
  media: InteractionMediaDTO[];
  /** Who answered, as the channel reports it: a Telegram name, a phone number, an email address. */
  sender: string | null;
  createdAt: number;
  readAt: number | null;
}

export type MessageStatus = "delivered" | "partial" | "failed" | "muted" | "throttled" | "paused";
export type MessageSource = "mcp" | "api" | "test" | "system";

export interface MessageDTO {
  id: string;
  agentId: string | null;
  agentName: string;
  priority: Priority;
  requestedPriority: Priority;
  topic: { key: string; name: string } | null;
  title: string | null;
  body: string;
  url: string | null;
  status: MessageStatus;
  /** 1 for a single send. Higher when identical messages were collapsed into this one. */
  repeatCount: number;
  lastRepeatAt: number | null;
  /** Plain sentences that explain routing decisions, for example "Text cap reached, sent to Telegram instead." */
  notes: string[];
  quiet: boolean;
  source: MessageSource;
  createdAt: number;
  deliveries: DeliveryDTO[];
  attachments: AttachmentDTO[];
  /** Choices the agent offered, in order. Option 1 is index 0. */
  options: string[];
  expectReply: boolean;
  /** Optional display name the agent set for this message, for example a project name. */
  senderName: string | null;
  interactions: InteractionDTO[];
  fallbacks: FallbackDTO[];
}

export type FallbackStatus = "pending" | "sending" | "sent" | "skipped" | "canceled";

export interface FallbackDTO {
  id: string;
  when: FallbackTrigger;
  afterMinutes: number;
  dueAt: number;
  status: FallbackStatus;
  /** Channel names at the time of the send. */
  channels: string[];
  priority: Priority | null;
  /** settings: the user's fallbacks for this priority. agent: the agent set them on this message. */
  source: "settings" | "agent";
  /** Why it was sent, skipped, or canceled. */
  detail: string | null;
  firedAt: number | null;
}

export type DeliveryStatus = "pending" | "sent" | "delivered" | "failed";

export interface DeliveryDTO {
  id: string;
  channelId: string;
  channelKind: ChannelKind;
  channelName: string;
  target: ChannelTarget;
  status: DeliveryStatus;
  detail: string | null;
  /** Set on fallback sends, for example "No answer after 5 minutes." */
  reason: string | null;
  updatedAt: number;
}

export interface MessagePage {
  items: MessageDTO[];
  /** Pass as `before` to load older messages. null at the end. */
  nextBefore: number | null;
}

export interface SendTestBody {
  priority: Priority;
  topic?: string;
}

export interface TopicDTO {
  id: string;
  key: string;
  name: string;
  muted: boolean;
  messageCount: number;
  lastUsedAt: number;
}
