import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import type { ChannelConfig } from "../../shared/channel-configs";
import type { ChannelKind, ChannelTarget } from "../../shared/channels";
import { adapters } from "../channels/index";
import type { ChannelAdapter, OutboundMessage, SendContext, SendResult, ThreadStore } from "../channels/types";
import { recordChannelUse, saveChannelConfig, type StoredChannel } from "../db/channels";
import { finishDelivery, insertDelivery, reserveSmsDelivery, type NewDelivery } from "../db/messages";
import { hmacSign, randomId } from "../lib/crypto";
import type { PlannedDelivery } from "./routing";

export function threadStore(db: D1Database, channelId: string): ThreadStore {
  return {
    async get(topicKey) {
      const row = await db
        .prepare("SELECT thread_ref FROM topic_threads WHERE channel_id = ? AND topic_key = ?")
        .bind(channelId, topicKey)
        .first<{ thread_ref: string }>();
      return row?.thread_ref ?? null;
    },
    async set(topicKey, threadRef) {
      await db
        .prepare(
          "INSERT INTO topic_threads (channel_id, topic_key, thread_ref, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (channel_id, topic_key) DO UPDATE SET thread_ref = excluded.thread_ref",
        )
        .bind(channelId, topicKey, threadRef, Date.now())
        .run();
    },
    async delete(topicKey) {
      await db.prepare("DELETE FROM topic_threads WHERE channel_id = ? AND topic_key = ?").bind(channelId, topicKey).run();
    },
  };
}

export async function smsCallbackUrl(env: Env, origin: string, deliveryId: string): Promise<string | null> {
  if (!origin.startsWith("https://")) return null;
  return `${origin}/hooks/sms/${deliveryId}/${await hmacSign(env.APP_SECRET, "callback", deliveryId)}`;
}

export function sendContext(env: Env, channel: StoredChannel, target: ChannelTarget, statusCallbackUrl: string | null): SendContext<ChannelKind> {
  return {
    env,
    channel: { id: channel.id, userId: channel.userId, name: channel.name, kind: channel.kind },
    config: channel.config as ChannelConfig<ChannelKind>,
    target,
    threads: threadStore(env.DB, channel.id),
    statusCallbackUrl,
    async saveConfig(patch) {
      channel.config = { ...channel.config, ...patch };
      await saveChannelConfig(env, channel.id, channel.config);
    },
  };
}

/** Sends one message to one channel and records the channel's last result. Adapter exceptions become failed results. */
export async function sendToChannel(
  env: Env,
  origin: string,
  channel: StoredChannel,
  target: ChannelTarget,
  message: OutboundMessage,
  deliveryId: string,
): Promise<SendResult> {
  const adapter = adapters[channel.kind] as ChannelAdapter<ChannelKind>;
  const callback = CHANNEL_CATALOG[channel.kind].isSms ? await smsCallbackUrl(env, origin, deliveryId) : null;
  let result: SendResult;
  try {
    result = await adapter.send(sendContext(env, channel, target, callback), message);
  } catch (error) {
    console.error("adapter.send threw", channel.kind, error);
    result = { ok: false, detail: `Beep Me could not send to ${CHANNEL_CATALOG[channel.kind].name}. Check the Worker logs.` };
  }
  await recordChannelUse(env, channel.id, result.ok ? null : (result.detail ?? "Send failed"));
  return result;
}

export interface DeliveryOutcome {
  deliveryId: string;
  channel: StoredChannel;
  target: ChannelTarget;
  ok: boolean;
  detail: string | null;
}

export interface DeliverOptions {
  messageId: string;
  userId: string;
  agentId: string | null;
  smsPerHour: number;
  fallback: PlannedDelivery[];
}

/** Writes delivery rows (reserving text slots under the cap), sends in parallel, and records each result. */
export async function deliverAll(
  env: Env,
  origin: string,
  message: OutboundMessage,
  planned: PlannedDelivery[],
  options: DeliverOptions,
): Promise<{ outcomes: DeliveryOutcome[]; notes: string[] }> {
  const notes: string[] = [];
  const queue = [...planned];
  const accepted: { delivery: NewDelivery; plan: PlannedDelivery }[] = [];
  const since = Date.now() - 3_600_000;
  let usedFallback = false;
  while (queue.length) {
    const plan = queue.shift()!;
    if (accepted.some((a) => a.plan.channel.id === plan.channel.id && a.plan.target === plan.target)) continue;
    const isSms = CHANNEL_CATALOG[plan.channel.kind].isSms;
    const delivery: NewDelivery = {
      id: randomId("dlv"),
      messageId: options.messageId,
      userId: options.userId,
      agentId: options.agentId,
      channelId: plan.channel.id,
      channelKind: plan.channel.kind,
      channelName: plan.channel.name,
      target: plan.target,
      isSms,
      createdAt: Date.now(),
    };
    if (isSms && !(await reserveSmsDelivery(env.DB, delivery, options.smsPerHour, since))) {
      const replacement = usedFallback ? [] : options.fallback;
      usedFallback = true;
      notes.push(
        replacement.length
          ? `Text limit reached (${options.smsPerHour} per hour for this agent). Sent to ${replacement.map((r) => r.channel.name).join(", ")} instead.`
          : `Text limit reached (${options.smsPerHour} per hour for this agent).`,
      );
      queue.push(...replacement);
      continue;
    }
    if (!isSms) await insertDelivery(env.DB, delivery);
    accepted.push({ delivery, plan });
  }
  const outcomes = await Promise.all(
    accepted.map(async ({ delivery, plan }) => {
      const result = await sendToChannel(env, origin, plan.channel, plan.target, { ...message, silent: plan.silent }, delivery.id);
      await finishDelivery(env.DB, delivery.id, result.ok ? "sent" : "failed", result.providerId ?? null, result.detail ?? null);
      return { deliveryId: delivery.id, channel: plan.channel, target: plan.target, ok: result.ok, detail: result.detail ?? null };
    }),
  );
  return { outcomes, notes };
}
