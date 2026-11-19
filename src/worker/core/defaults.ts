import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import type { ChannelKind } from "../../shared/channels";
import type { Destination, Routes, UserSettings } from "../../shared/settings";
import { channelTargets, type StoredChannel } from "../db/channels";

type Pick = Destination | null;

/** Routes that follow the connected channels: texts for high and urgent, the Telegram main chat for medium, topic threads for low. */
export function automaticRoutes(channels: StoredChannel[]): Routes {
  const ready = channels.filter((channel) => channel.enabled && channel.status === "ready");
  const first = (kinds: ChannelKind[], target: "main" | "topic" = "main"): Pick => {
    const channel = ready.find((c) => kinds.includes(c.kind) && channelTargets(c).includes(target));
    return channel ? { channelId: channel.id, target } : null;
  };
  const sms = first(["twilio", "telnyx"]);
  const push = first(["pushover", "ntfy"]);
  const telegram = first(["telegram"]);
  const telegramTopic = first(["telegram"], "topic");
  const discordTopic = first(["discord"], "topic");
  const chat = first(["slack", "discord"]);
  const email = first(["gmail", "resend", "smtp"]);
  const webhook = first(["webhook"]);
  const pickFirst = (...picks: Pick[]): Destination[] => {
    const found = picks.find((pick) => pick !== null);
    return found ? [found] : [];
  };
  const urgent = [sms, push].filter((pick): pick is Destination => pick !== null);
  return {
    urgent: urgent.length ? urgent : pickFirst(telegram, chat, email, webhook),
    high: pickFirst(sms, push, telegram, chat, email, webhook),
    medium: pickFirst(telegram, push, chat, email, webhook),
    low: pickFirst(telegramTopic, discordTopic, telegram, chat, push, email, webhook),
  };
}

export function effectiveRoutes(settings: UserSettings, channels: StoredChannel[]): Routes {
  return settings.routesCustomized ? settings.routes : automaticRoutes(channels);
}

export function isSmsKind(kind: ChannelKind): boolean {
  return CHANNEL_CATALOG[kind].isSms;
}
