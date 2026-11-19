import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import type { ChannelTarget } from "../../shared/channels";
import { PRIORITIES, PRIORITY_INFO, priorityRank, type Priority } from "../../shared/priority";
import type { Destination, Rule, UserSettings } from "../../shared/settings";
import { channelTargets, type StoredChannel } from "../db/channels";
import { effectiveRoutes } from "./defaults";
import { isQuietNow } from "./quiet";

export interface PlannedDelivery {
  channel: StoredChannel;
  target: ChannelTarget;
  silent: boolean;
}

export interface RoutePlan {
  muted: boolean;
  deliveries: PlannedDelivery[];
  /** Non-text deliveries to use when a text is skipped or capped. */
  fallback: PlannedDelivery[];
  notes: string[];
  quiet: boolean;
}

export interface RouteRequest {
  settings: UserSettings;
  channels: StoredChannel[];
  priority: Priority;
  topicKey: string | null;
  agentId: string | null;
  /** null allows every channel. */
  allowedChannelIds: string[] | null;
  now: number;
}

export function globMatch(pattern: string, value: string): boolean {
  const source = pattern
    .trim()
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(value.toLowerCase());
}

export function matchRule(rules: Rule[], request: Pick<RouteRequest, "priority" | "topicKey" | "agentId">): Rule | null {
  return (
    rules.find((rule) => {
      if (!rule.enabled) return false;
      const { priorities, topics, agentIds } = rule.match;
      if (priorities?.length && !priorities.includes(request.priority)) return false;
      if (topics?.length && !(request.topicKey && topics.some((pattern) => globMatch(pattern, request.topicKey!)))) return false;
      if (agentIds?.length && !(request.agentId && agentIds.includes(request.agentId))) return false;
      return true;
    }) ?? null
  );
}

function resolve(request: RouteRequest, destinations: Destination[], quiet: boolean, allowSms: boolean): PlannedDelivery[] {
  const out: PlannedDelivery[] = [];
  for (const destination of destinations) {
    const channel = request.channels.find((c) => c.id === destination.channelId);
    if (!channel || !channel.enabled || channel.status !== "ready") continue;
    if (request.allowedChannelIds && !request.allowedChannelIds.includes(channel.id)) continue;
    const info = CHANNEL_CATALOG[channel.kind];
    if (info.isSms && !allowSms) continue;
    const targets = channelTargets(channel);
    const target: ChannelTarget = destination.target === "topic" && request.topicKey && targets.includes("topic") ? "topic" : "main";
    if (!targets.includes(target)) continue;
    if (out.some((d) => d.channel.id === channel.id && d.target === target)) continue;
    out.push({ channel, target, silent: quiet && info.supportsSilent });
  }
  return out;
}

/** Lower routes first, then any usable non-text channel, so nothing is dropped without a reason. */
function fallbackFor(request: RouteRequest, quiet: boolean): PlannedDelivery[] {
  const routes = effectiveRoutes(request.settings, request.channels);
  for (let rank = priorityRank(request.priority) - 1; rank >= 0; rank--) {
    const found = resolve(request, routes[PRIORITIES[rank]!], quiet, false);
    if (found.length) return found;
  }
  const any = request.channels.map((c) => ({ channelId: c.id, target: "main" as const }));
  return resolve(request, any, quiet, false).slice(0, 1);
}

function quietSound(deliveries: PlannedDelivery[]): string {
  if (deliveries.every((delivery) => delivery.silent)) return " without sound";
  if (deliveries.some((delivery) => delivery.silent)) return ", without sound where the channel allows it";
  return ". These channels have no silent option";
}

function names(deliveries: PlannedDelivery[]): string {
  return deliveries.map((d) => d.channel.name + (d.target === "topic" ? " (topic)" : "")).join(", ");
}

export function planRoute(request: RouteRequest): RoutePlan {
  const notes: string[] = [];
  const { settings, priority } = request;
  const rule = matchRule(settings.rules, request);
  if (rule?.action.type === "mute") {
    return { muted: true, deliveries: [], fallback: [], notes: [`The rule "${rule.name}" muted this message.`], quiet: false };
  }
  const quiet =
    isQuietNow(settings.quietHours, settings.timezone, request.now) &&
    priorityRank(priority) < priorityRank(settings.quietHours.breakthrough);
  const destinations = rule?.action.type === "route" ? rule.action.destinations : effectiveRoutes(settings, request.channels)[priority];
  if (rule) notes.push(`The rule "${rule.name}" picked the destinations.`);
  let deliveries = resolve(request, destinations, quiet, !quiet);
  const fallback = fallbackFor(request, quiet);
  const skippedText = quiet && resolve(request, destinations, false, true).some((d) => CHANNEL_CATALOG[d.channel.kind].isSms);
  if (!deliveries.length && fallback.length) {
    deliveries = fallback;
    notes.push(
      skippedText
        ? `Quiet hours: skipped the text and sent to ${names(fallback)}${quietSound(fallback)}.`
        : `No channel for ${PRIORITY_INFO[priority].label} was usable. Beep Me sent it to ${names(fallback)} instead.`,
    );
  } else if (quiet && !deliveries.length && skippedText) {
    notes.push("Quiet hours: Beep Me held the text. No other channel can take this message, so Beep Me sent nothing.");
    return { muted: true, deliveries: [], fallback, notes, quiet };
  } else if (quiet && deliveries.length) {
    notes.push(skippedText ? `Quiet hours: skipped the text. Delivered${quietSound(deliveries)}.` : `Quiet hours: delivered${quietSound(deliveries)}.`);
  }
  if (!deliveries.length) notes.push("No channel could take this message. Connect a channel or check this agent's channel access.");
  return { muted: false, deliveries, fallback, notes, quiet };
}
