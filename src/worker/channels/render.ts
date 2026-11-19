import { PRIORITY_INFO, type Priority } from "../../shared/priority";
import { clip, clipBy, isHttpUrl } from "./http";
import type { OutboundMessage } from "./types";

export const DOT = " · ";
const TEST_TAG = "\u{1F9EA} Test";
const HEADLINE_MAX = 256;

export const PRIORITY_COLOR: Record<Priority, string> = {
  urgent: "#dc2626",
  high: "#ea580c",
  medium: "#2563eb",
  low: "#9ca3af",
};

export function priorityText(message: OutboundMessage): string {
  const info = PRIORITY_INFO[message.priority];
  return `${info.emoji} ${info.label}`;
}

/** Title, or the first body line when there is no title. The body then starts after that line. */
export function parts(message: OutboundMessage): { headline: string; body: string } {
  const title = message.title?.trim();
  if (title) return { headline: clip(oneLine(title), HEADLINE_MAX), body: message.body.trim() };
  const [first = "", ...rest] = message.body.trim().split("\n");
  return { headline: clip(first.trim() || "Notification", HEADLINE_MAX), body: rest.join("\n").trim() };
}

export function oneLine(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trim();
}

export function topicTag(message: OutboundMessage): string | null {
  if (!message.topic) return null;
  const tag = message.topic.name.replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "");
  return `#${tag || message.topic.key}`;
}

/** "Cat Design Project (Claude Code)" when the agent set a sender name, else the agent name. */
export function senderLabel(message: OutboundMessage): string {
  return message.senderName ? `${message.senderName} (${message.agent.name})` : message.agent.name;
}

/** "Reply with a number: 1) Ship it 2) Wait" for channels that cannot show buttons. */
export function optionsText(message: OutboundMessage): string | null {
  if (!message.options.length) return message.expectReply ? "Reply to this message to answer." : null;
  return `Reply with a number: ${message.options.map((option, index) => `${index + 1}) ${option}`).join("  ")}`;
}

/** "🟠 High · agent · #topic", with a test tag on test messages. */
export function metaLine(message: OutboundMessage): string {
  return [message.test ? TEST_TAG : null, priorityText(message), senderLabel(message), topicTag(message)]
    .filter((part): part is string => Boolean(part))
    .join(DOT);
}

export function plainText(message: OutboundMessage): string {
  const { headline, body } = parts(message);
  return [metaLine(message), headline, body, message.url].filter(Boolean).join("\n");
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const TELEGRAM_LIMIT = 4096;

/** Telegram HTML. Text is cut before escaping, so the visible length stays within 4096. */
export function telegramHtml(message: OutboundMessage, footer = ""): string {
  const { headline, body } = parts(message);
  const info = PRIORITY_INFO[message.priority];
  const metaRest = [senderLabel(message), topicTag(message)].filter(Boolean).join(DOT);
  const meta = `${message.test ? `${TEST_TAG}${DOT}` : ""}${info.emoji} <b>${info.label}</b>${DOT}${escapeHtml(metaRest)}`;
  const urlText = message.url ? clip(message.url, 200) : "";
  const link = !message.url ? "" : isHttpUrl(message.url) ? `<a href="${escapeHtml(message.url)}">${escapeHtml(urlText)}</a>` : escapeHtml(urlText);
  const visibleFixed = [metaLine(message), headline, urlText, footer].join("\n\n").length;
  const bodyText = clip(body, Math.max(TELEGRAM_LIMIT - visibleFixed - 8, 0));
  const blocks = [meta, `<b>${escapeHtml(headline)}</b>`, bodyText ? escapeHtml(bodyText) : "", link, footer ? `<i>${escapeHtml(footer)}</i>` : ""];
  return blocks.filter(Boolean).join("\n\n");
}

export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Slack mrkdwn for the notification text fallback and the section block. */
export function slackMrkdwn(message: OutboundMessage, max = 3000): { fallback: string; section: string; context: string } {
  const { headline, body } = parts(message);
  const header = `*${escapeSlack(headline)}*`;
  const url = !message.url ? "" : isHttpUrl(message.url) ? `<${message.url}|Open link>` : escapeSlack(clip(message.url, 500));
  const budget = max - header.length - (url ? url.length + 1 : 0) - 1;
  const escapedBody = body ? escapeSlack(clipBy(body, Math.max(budget, 0), (char) => escapeSlack(char).length)) : "";
  const section = [header, escapedBody, url].filter(Boolean).join("\n");
  const fallbackRaw = [metaLine(message), headline, body, message.url].filter(Boolean).join("\n");
  const fallback = escapeSlack(clipBy(fallbackRaw, max, (char) => escapeSlack(char).length));
  return { fallback, section, context: escapeSlack(metaLine(message)) };
}

export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  url?: string;
  image?: { url: string };
  footer: { text: string };
  timestamp: string;
}

/** `image` is an `attachment://` name or a public URL. `links` are files that were not uploaded. */
export interface DiscordFiles {
  image: string | null;
  links: { name: string; url: string }[];
}

/** Discord markdown embed. Footer is "agent · topic". Choices and file links come after the body. */
export function discordEmbed(message: OutboundMessage, files: DiscordFiles = { image: null, links: [] }): DiscordEmbed {
  const { headline, body } = parts(message);
  const info = PRIORITY_INFO[message.priority];
  const lead = `${message.test ? `${TEST_TAG}${DOT}` : ""}${info.emoji} **${info.label}**${DOT}${senderLabel(message)}`;
  const link = message.url && !isHttpUrl(message.url) ? `\n${message.url}` : "";
  const choices = optionsText(message);
  const tail = [
    ...files.links.map((file) => `\u{1F4CE} [${file.name.replace(/[[\]]/g, "")}](${file.url})`),
    choices ? `${choices}\n[Open in Beep Me](${message.appUrl})` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const main = clip(`${lead}\n\n${body}${link}`.trim(), Math.max(4096 - tail.length - 2, 0));
  return {
    title: clip(headline, 256),
    description: clip(tail ? `${main}\n\n${tail}` : main, 4096),
    color: parseInt(PRIORITY_COLOR[message.priority].slice(1), 16),
    ...(isHttpUrl(message.url) ? { url: message.url } : {}),
    ...(files.image ? { image: { url: files.image } } : {}),
    footer: { text: clip([senderLabel(message), message.topic?.name].filter(Boolean).join(DOT), 2048) },
    timestamp: new Date(message.createdAt).toISOString(),
  };
}
