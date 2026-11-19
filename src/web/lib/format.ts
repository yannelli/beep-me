import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import type { ChannelTarget } from "../../shared/channels";
import type { ChannelDTO } from "../../shared/api";
import type { Destination } from "../../shared/settings";

export function relativeTime(ms: number | null, now = Date.now()): string {
  if (!ms) return "never";
  const seconds = Math.round((now - ms) / 1000);
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function untilTime(ms: number): string {
  const sameDay = new Date(ms).toDateString() === new Date().toDateString();
  return new Date(ms).toLocaleString(undefined, sameDay ? { hour: "numeric", minute: "2-digit" } : { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function hashHue(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

export function targetLabel(channel: Pick<ChannelDTO, "kind">, target: ChannelTarget): string {
  if (target === "topic") return channel.kind === "discord" ? "Forum posts" : "Topic threads";
  return channel.kind === "telegram" ? "Main chat" : "Main";
}

/** "Telegram · Main chat" for channels with several targets, else the channel name. */
export function destinationName(channel: Pick<ChannelDTO, "kind" | "name">, target: ChannelTarget): string {
  return target === "main" && channel.kind !== "telegram" ? channel.name : `${channel.name} · ${targetLabel(channel, target)}`;
}

export function destinationLabel(destination: Destination, channels: ChannelDTO[]): { label: string; color: string; stale: boolean } {
  const channel = channels.find((item) => item.id === destination.channelId);
  if (!channel) return { label: "Deleted channel", color: "#71717a", stale: true };
  const stale = channel.targets.length > 0 && !channel.targets.includes(destination.target);
  return {
    label: destinationName(channel, destination.target),
    color: CHANNEL_CATALOG[channel.kind].color,
    stale,
  };
}

export function channelTargets(channel: ChannelDTO): ChannelTarget[] {
  return channel.targets.length > 0 ? channel.targets : ["main"];
}

export function randomId(length = 10): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** "right away", "after 5 min", "after 2 h". */
export function afterLabel(minutes: number): string {
  if (minutes === 0) return "right away";
  return minutes % 60 === 0 ? `after ${minutes / 60} h` : `after ${minutes} min`;
}
