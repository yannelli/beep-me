import { z } from "zod";
import type { MessageSource, MessageStatus } from "../../shared/api";
import type { ChannelKind, ChannelTarget } from "../../shared/channels";
import { PRIORITIES, PRIORITY_INFO, minPriority, priorityRank, type Priority } from "../../shared/priority";
import type { FallbackTrigger, UserSettings } from "../../shared/settings";
import { adapters } from "../channels/index";
import type { ChannelAdapter, OutboundMessage } from "../channels/types";
import type { Agent } from "../db/agents";
import { getChannel, listChannels } from "../db/channels";
import {
  bumpRepeat,
  countThrottled,
  deliveriesFor,
  findCollapseTarget,
  finishMessage,
  getMessage,
  insertMessage,
  insertMessageUnderCap,
  type NewMessage,
} from "../db/messages";
import { normalizeTopic, touchTopic, type TopicRef } from "../db/topics";
import type { User } from "../db/users";
import { hmacSign, randomId, sha256Hex } from "../lib/crypto";
import { deliverAll, sendContext } from "./deliver";
import { httpUrl, notifyExtrasShape, prepareAttachments } from "./extras";
import { fireDueNow, scheduleFallbacks } from "./fallbacks";
import { toOutboundAttachment } from "./media";
import { formatClock } from "./quiet";
import { destinationsFor, planRoute } from "./routing";

export const notifyInputShape = {
  message: z.string().trim().min(1).max(4000),
  title: z.string().trim().max(200).nullish(),
  priority: z.enum(PRIORITIES).default("medium"),
  topic: z.string().trim().max(64).nullish(),
  url: httpUrl.nullish(),
  dedupe_key: z.string().trim().max(200).nullish(),
  ...notifyExtrasShape,
};
export const notifyInputSchema = z.object(notifyInputShape);
export type NotifyInput = z.infer<typeof notifyInputSchema>;

export interface Sender {
  agent: Agent | null;
  name: string;
  source: MessageSource;
}

export interface NotifyResult {
  id: string;
  status: MessageStatus | "collapsed";
  priority: Priority;
  requested_priority: Priority;
  topic: string | null;
  quiet: boolean;
  repeat_count: number;
  deliveries: { channel: string; channel_id: string; kind: ChannelKind; target: ChannelTarget; ok: boolean; detail: string | null }[];
  /** Fallback steps waiting for their time. */
  fallbacks: { id: string; when: FallbackTrigger; after_minutes: number; due_at: string; channels: string[] }[];
  /** For messages that ask something: GET it to wait for an answer without reading it. */
  watch_url: string | null;
  notes: string[];
}

/** Signed URL that reports whether a message has answers. It reveals no answer text. */
export async function watchUrl(env: Env, origin: string, messageId: string): Promise<string> {
  return `${origin}/v1/watch/${messageId}/${await hmacSign(env.APP_SECRET, "callback", `watch:${messageId}`)}`;
}

export interface RunContext {
  env: Env;
  origin: string;
  waitUntil(promise: Promise<unknown>): void;
}

const label = (priority: Priority) => PRIORITY_INFO[priority].label;

function holdReason(settings: UserSettings, agent: Agent | null, topic: TopicRef | null, priority: Priority, now: number) {
  if (settings.pausedUntil && settings.pausedUntil > now) {
    return { status: "paused" as const, note: `Beep Me is paused until ${formatClock(settings.pausedUntil, settings.timezone)}. It sent nothing.` };
  }
  if (agent?.mutedUntil && agent.mutedUntil > now) {
    return { status: "muted" as const, note: `${agent.name} is muted until ${formatClock(agent.mutedUntil, settings.timezone)}.` };
  }
  if (topic?.muted && priorityRank(priority) < priorityRank("high")) {
    return { status: "muted" as const, note: `The topic "${topic.name}" is muted. High and urgent messages still go out.` };
  }
  return null;
}

export async function notify(run: RunContext, user: User, sender: Sender, input: NotifyInput): Promise<NotifyResult> {
  const { env, origin } = run;
  const { settings } = user;
  const now = Date.now();
  const agent = sender.agent;
  const requested = input.priority;
  const priority = agent ? minPriority(requested, agent.maxPriority) : requested;
  const notes: string[] = [];
  if (priority !== requested) notes.push(`Beep Me lowered the priority from ${label(requested)} to ${label(priority)}, the limit for this agent.`);
  const normalized = normalizeTopic(input.topic);
  const topic = normalized ? await touchTopic(env.DB, user.id, normalized) : null;
  const title = input.title?.trim() || null;
  const hashSource = input.dedupe_key
    ? `key\u0000${agent?.id ?? sender.name}\u0000${input.dedupe_key}`
    : [agent?.id ?? sender.name, topic?.key ?? "", title ?? "", input.message].join("\u0000");
  const attachments = await prepareAttachments(env, origin, input.attachments);
  const message: NewMessage = {
    id: randomId("msg"),
    userId: user.id,
    agentId: agent?.id ?? null,
    agentName: sender.name,
    priority,
    requestedPriority: requested,
    topic: topic ? { key: topic.key, name: topic.name } : null,
    title,
    body: input.message,
    url: input.url ?? null,
    dedupeHash: await sha256Hex(hashSource),
    status: "pending",
    notes,
    quiet: false,
    source: sender.source,
    createdAt: now,
    attachments,
    options: input.options ?? [],
    expectReply: input.expect_reply === true || Boolean(input.options?.length),
    senderName: input.sender_name ?? null,
  };
  const result = (status: NotifyResult["status"], extra: Partial<NotifyResult> = {}): NotifyResult => ({
    id: message.id,
    status,
    priority,
    requested_priority: requested,
    topic: topic?.name ?? null,
    quiet: false,
    repeat_count: 1,
    deliveries: [],
    fallbacks: [],
    watch_url: null,
    notes,
    ...extra,
  });

  const hold = holdReason(settings, agent, topic, priority, now);
  if (hold) {
    notes.push(hold.note);
    await insertMessage(env.DB, { ...message, status: hold.status });
    return result(hold.status);
  }

  if (sender.source !== "test" && settings.limits.collapseMinutes > 0) {
    const originalId = await findCollapseTarget(env.DB, user.id, message.dedupeHash, now - settings.limits.collapseMinutes * 60_000);
    if (originalId) {
      const count = await bumpRepeat(env.DB, originalId);
      run.waitUntil(markRepeats(run, user, originalId, count));
      notes.push(`This message is the same as one sent in the last ${settings.limits.collapseMinutes} minutes. Beep Me added it to that message (×${count}).`);
      return { ...result("collapsed", { repeat_count: count }), id: originalId };
    }
  }

  if (agent) {
    const limit = agent.messagesPerHour ?? settings.limits.messagesPerHour;
    if (!(await insertMessageUnderCap(env.DB, message, limit, now - 3_600_000))) {
      const firstHold = (await countThrottled(env.DB, agent.id, now - 3_600_000)) === 0;
      notes.push(`Rate limit reached: ${limit} messages per hour for ${agent.name}. Beep Me held this message.`);
      await insertMessage(env.DB, { ...message, status: "throttled" });
      if (firstHold) run.waitUntil(alertThrottled(run, user, agent, limit));
      return result("throttled");
    }
  } else {
    await insertMessage(env.DB, message);
  }

  const channels = await listChannels(env, user.id);
  const picked = input.channels ? destinationsFor(channels, input.channels, input.topic_thread ? "topic" : "main") : null;
  if (picked?.unknown.length) notes.push(`Beep Me found no channel named ${picked.unknown.map((ref) => `"${ref}"`).join(", ")}. list_channels shows the names.`);
  const plan = planRoute({
    settings,
    channels,
    priority,
    topicKey: topic?.key ?? null,
    agentId: agent?.id ?? null,
    allowedChannelIds: agent?.channelIds ?? null,
    now,
    requested: picked?.destinations ?? null,
    topicThread: input.topic_thread === true && !picked,
  });
  notes.push(...plan.notes);
  if (plan.muted) {
    await finishMessage(env.DB, message.id, "muted", notes, plan.quiet);
    return result("muted", { quiet: plan.quiet });
  }
  const outbound: OutboundMessage = {
    id: message.id,
    title,
    body: input.message,
    priority,
    topic: message.topic,
    url: message.url,
    agent: { id: agent?.id ?? null, name: sender.name },
    silent: false,
    appUrl: `${origin}/?message=${message.id}`,
    test: sender.source === "test",
    createdAt: now,
    attachments: attachments.map((attachment) => toOutboundAttachment(env, origin, attachment)),
    options: message.options,
    expectReply: message.expectReply,
    senderName: message.senderName,
  };
  const { outcomes, notes: deliveryNotes } = await deliverAll(env, origin, outbound, plan.deliveries, {
    messageId: message.id,
    userId: user.id,
    agentId: agent?.id ?? null,
    smsPerHour: agent?.smsPerHour ?? settings.limits.smsPerHour,
    fallback: plan.fallback,
  });
  notes.push(...deliveryNotes);
  const sent = outcomes.filter((outcome) => outcome.ok).length;
  const status: MessageStatus = sent === 0 ? "failed" : sent === outcomes.length ? "delivered" : "partial";
  const scheduled = sender.source === "system"
    ? { rows: [], notes: [] }
    : await scheduleFallbacks(env.DB, {
        userId: user.id,
        messageId: message.id,
        origin,
        channels,
        settingsSteps: settings.fallbacks[priority],
        agentSteps: input.fallbacks,
        now,
      });
  notes.push(...scheduled.notes);
  await finishMessage(env.DB, message.id, status, notes, plan.quiet);
  const fired = await fireDueNow(env, scheduled.rows, now);
  notes.push(...fired.map((detail) => `Fallback: ${detail}`));
  const finalStatus = fired.length ? ((await getMessage(env.DB, user.id, message.id))?.status ?? status) : status;
  const due = scheduled.rows.filter((row) => row.due_at > now);
  if (due.length) notes.push(`${due.length} fallback step${due.length > 1 ? "s" : ""} will run if needed. cancel_fallbacks stops them.`);
  return result(finalStatus, {
    quiet: plan.quiet,
    deliveries: outcomes.map((o) => ({ channel: o.channel.name, channel_id: o.channel.id, kind: o.channel.kind, target: o.target, ok: o.ok, detail: o.detail })),
    fallbacks: due.map((row) => ({
      id: row.id,
      when: row.trigger_kind,
      after_minutes: row.after_minutes,
      due_at: new Date(row.due_at).toISOString(),
      channels: JSON.parse(row.channel_names) as string[],
    })),
    watch_url: message.expectReply ? await watchUrl(env, origin, message.id) : null,
  });
}

async function markRepeats(run: RunContext, user: User, messageId: string, count: number): Promise<void> {
  const original = await getMessage(run.env.DB, user.id, messageId);
  if (!original) return;
  const outbound: OutboundMessage = {
    id: original.id,
    title: original.title,
    body: original.body,
    priority: original.priority,
    topic: original.topic,
    url: original.url,
    agent: { id: original.agentId, name: original.agentName },
    silent: original.quiet,
    appUrl: `${run.origin}/?message=${original.id}`,
    test: original.source === "test",
    createdAt: original.createdAt,
    attachments: original.attachments.map((attachment) => toOutboundAttachment(run.env, run.origin, attachment)),
    options: original.options,
    expectReply: original.expectReply,
    senderName: original.senderName,
  };
  for (const delivery of await deliveriesFor(run.env.DB, [messageId])) {
    const adapter = adapters[delivery.channel_kind] as ChannelAdapter<ChannelKind>;
    if (!adapter.markRepeat || !delivery.provider_id || delivery.status === "failed") continue;
    const channel = await getChannel(run.env, user.id, delivery.channel_id);
    if (!channel) continue;
    await adapter
      .markRepeat(sendContext(run.env, channel, delivery.target, null), delivery.provider_id, outbound, count)
      .catch((error: unknown) => console.warn("markRepeat failed", delivery.channel_kind, error));
  }
}

async function alertThrottled(run: RunContext, user: User, agent: Agent, limit: number): Promise<void> {
  await notify(run, user, { agent: null, name: "Beep Me", source: "system" }, {
    title: `${agent.name} hit its rate limit`,
    message: `${agent.name} sent more than ${limit} messages in the last hour. Beep Me does not send its messages until it is under that limit again. Activity shows the held messages. If it is stuck, mute or revoke it in Beep Me.`,
    priority: "medium",
    topic: null,
    url: run.origin.startsWith("https://") ? `${run.origin}/agents/${agent.id}` : null,
  }).catch((error: unknown) => console.warn("throttle alert failed", error));
}
