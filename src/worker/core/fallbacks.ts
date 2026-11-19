import type { DeliveryDTO, MessageDTO, MessageStatus } from "../../shared/api";
import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import { minPriority, type Priority } from "../../shared/priority";
import type { Destination, FallbackStep, FallbackTrigger } from "../../shared/settings";
import type { OutboundMessage } from "../channels/types";
import { getAgent } from "../db/agents";
import { listChannels, type StoredChannel } from "../db/channels";
import {
  claimDueFallbacks,
  claimFallback,
  fallbackDestinations,
  finishFallback,
  insertFallbacks,
  skipStuckFallbacks,
  type FallbackRow,
  type NewFallback,
} from "../db/fallbacks";
import { getMessage, updateMessageAfterSend } from "../db/messages";
import { getUser } from "../db/users";
import { deliverAll } from "./deliver";
import type { FallbackInput } from "./extras";
import { toOutboundAttachment } from "./media";
import { destinationsFor, isQuietFor, resolve } from "./routing";

export interface ScheduleRequest {
  userId: string;
  messageId: string;
  origin: string;
  channels: StoredChannel[];
  /** The user's steps for the message priority. */
  settingsSteps: FallbackStep[];
  /** Steps the agent set on the message. They replace settingsSteps, and an empty list turns fallbacks off. */
  agentSteps: FallbackInput[] | undefined;
  now: number;
}

function names(channels: StoredChannel[], destinations: Destination[]): string[] {
  return destinations.map((d) => {
    const name = channels.find((c) => c.id === d.channelId)?.name ?? "Deleted channel";
    return d.target === "topic" ? `${name} (topic thread)` : name;
  });
}

/** Stores the fallback steps for a message that went out. Returns the rows and notes for steps Beep Me could not use. */
export async function scheduleFallbacks(db: D1Database, request: ScheduleRequest): Promise<{ rows: FallbackRow[]; notes: string[] }> {
  const notes: string[] = [];
  const base = { userId: request.userId, messageId: request.messageId, origin: request.origin, createdAt: request.now };
  const items: NewFallback[] = [];
  if (request.agentSteps) {
    for (const step of request.agentSteps) {
      const { destinations, unknown } = destinationsFor(request.channels, step.channels, "main");
      if (unknown.length) notes.push(`Fallback: Beep Me found no channel named ${unknown.map((ref) => `"${ref}"`).join(", ")}.`);
      if (!destinations.length) continue;
      const priority = step.priority ?? null;
      items.push({ ...base, when: step.when, afterMinutes: step.after_minutes, destinations, priority, source: "agent", channelNames: names(request.channels, destinations) });
    }
  } else {
    for (const step of request.settingsSteps) {
      const { destinations, priority } = step;
      items.push({ ...base, when: step.when, afterMinutes: step.afterMinutes, destinations, priority, source: "settings", channelNames: names(request.channels, destinations) });
    }
  }
  return { rows: await insertFallbacks(db, items), notes };
}

const GOOD = new Set(["sent", "delivered"]);

function confirmed(delivery: DeliveryDTO): boolean {
  return delivery.status === "delivered" || (delivery.status === "sent" && !CHANNEL_CATALOG[delivery.channelKind].isSms);
}

/** Whether the step's trigger still holds for the message as it is now. */
export function triggerHolds(when: FallbackTrigger, message: MessageDTO): boolean {
  if (when === "no_reply") return message.interactions.length === 0;
  if (when === "failed") return !message.deliveries.some((d) => d.status !== "failed");
  return !message.deliveries.some(confirmed);
}

function reasonFor(row: FallbackRow): string {
  const after = row.after_minutes === 1 ? "1 minute" : `${row.after_minutes} minutes`;
  if (row.trigger_kind === "no_reply") return row.after_minutes ? `No answer after ${after}.` : "No answer yet.";
  if (row.trigger_kind === "failed") return "Every send failed.";
  return row.after_minutes ? `Not confirmed after ${after}.` : "Not confirmed.";
}

function canceledDetail(when: FallbackTrigger): string {
  if (when === "no_reply") return "Answered before this step was due.";
  if (when === "failed") return "A send worked before this step was due.";
  return "A send was confirmed before this step was due.";
}

function overallStatus(deliveries: { ok: boolean }[]): MessageStatus {
  const sent = deliveries.filter((d) => d.ok).length;
  return sent === 0 ? "failed" : sent === deliveries.length ? "delivered" : "partial";
}

/** Sends one claimed step, or records why it did not send. Returns that detail. */
export async function fireFallback(env: Env, row: FallbackRow, now = Date.now()): Promise<string> {
  const skip = async (detail: string) => {
    await finishFallback(env.DB, row.id, "skipped", detail);
    return detail;
  };
  const user = await getUser(env.DB, row.user_id);
  const message = user ? await getMessage(env.DB, user.id, row.message_id) : null;
  if (!user || !message) return skip("The message was deleted.");
  if (!triggerHolds(row.trigger_kind, message)) {
    await finishFallback(env.DB, row.id, "canceled", canceledDetail(row.trigger_kind));
    return canceledDetail(row.trigger_kind);
  }
  const { settings } = user;
  if (settings.pausedUntil && settings.pausedUntil > now) return skip("Beep Me was paused.");
  const agent = message.agentId ? await getAgent(env.DB, message.agentId, user.id) : null;
  if (message.agentId && (!agent || agent.status !== "active")) return skip("The agent was revoked.");
  if (agent?.mutedUntil && agent.mutedUntil > now) return skip(`${agent.name} was muted.`);

  const requested = (row.priority ?? message.priority) as Priority;
  const priority = agent && row.source === "agent" ? minPriority(requested, agent.maxPriority) : requested;
  const channels = await listChannels(env, user.id);
  const quiet = isQuietFor(settings, priority, now);
  const scope = { channels, allowedChannelIds: agent?.channelIds ?? null, topicKey: message.topic?.key ?? null };
  const planned = resolve(scope, fallbackDestinations(row), quiet, !quiet);
  if (!planned.length) return skip("No channel in this step could take the message. Check that it is on, ready, and allowed for this agent, and quiet hours.");

  const reason = reasonFor(row);
  const outbound: OutboundMessage = {
    id: message.id,
    title: row.trigger_kind === "no_reply" ? `Reminder: ${message.title ?? message.body.slice(0, 60)}` : message.title,
    body: message.body,
    priority,
    topic: message.topic,
    url: message.url,
    agent: { id: message.agentId, name: message.agentName },
    silent: false,
    appUrl: `${row.origin}/?message=${message.id}`,
    test: message.source === "test",
    createdAt: message.createdAt,
    attachments: message.attachments.map((attachment) => toOutboundAttachment(env, row.origin, attachment)),
    options: message.options,
    expectReply: message.expectReply,
    senderName: message.senderName,
  };
  const { outcomes, notes } = await deliverAll(env, row.origin, outbound, planned, {
    messageId: message.id,
    userId: user.id,
    agentId: message.agentId,
    smsPerHour: agent?.smsPerHour ?? settings.limits.smsPerHour,
    fallback: [],
    reason,
  });
  const sentTo = outcomes.filter((o) => o.ok).map((o) => o.channel.name);
  const failed = outcomes.filter((o) => !o.ok).map((o) => `${o.channel.name}: ${o.detail ?? "failed"}`);
  const detail = [reason, sentTo.length ? `Sent to ${sentTo.join(", ")}.` : "", failed.length ? `Failed: ${failed.join("; ")}.` : "", ...notes].filter(Boolean).join(" ");
  const all = [...message.deliveries.map((d) => ({ ok: GOOD.has(d.status) })), ...outcomes];
  await updateMessageAfterSend(env.DB, message.id, overallStatus(all), [`Fallback: ${detail}`]);
  await finishFallback(env.DB, row.id, sentTo.length ? "sent" : "skipped", detail, outcomes.map((o) => o.channel.name));
  return detail;
}

/** Fires due steps right away, for example a failed step with 0 minutes. Others wait for the cron. Returns what each did. */
export async function fireDueNow(env: Env, rows: FallbackRow[], now: number): Promise<string[]> {
  const details: string[] = [];
  for (const row of rows) {
    if (row.due_at > now || !(await claimFallback(env.DB, row.id, now))) continue;
    details.push(await fireFallback(env, row, now).catch((error: unknown) => failRow(env, row, error)));
  }
  return details;
}

async function failRow(env: Env, row: FallbackRow, error: unknown): Promise<string> {
  console.error("fallback failed", row.id, error);
  const detail = "Beep Me hit an error while it sent this step. Check the Worker logs.";
  await finishFallback(env.DB, row.id, "skipped", detail);
  return detail;
}

/** Cron entry: sends every due step once. */
export async function runDueFallbacks(env: Env, now = Date.now()): Promise<void> {
  await skipStuckFallbacks(env.DB, now - 10 * 60_000);
  for (let round = 0; round < 4; round++) {
    const rows = await claimDueFallbacks(env.DB, now);
    for (const row of rows) await fireFallback(env, row, now).catch((error: unknown) => failRow(env, row, error));
    if (rows.length < 25) return;
  }
}
