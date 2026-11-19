import { PRIORITY_INFO } from "../../shared/priority";
import { isHttpUrl } from "./http";
import { DOT, PRIORITY_COLOR, escapeHtml, metaLine, oneLine, optionsText, parts, plainText } from "./render";
import type { OutboundAttachment, OutboundMessage } from "./types";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export interface EmailOptions {
  subjectPrefix?: string;
  /** True when replies to this email reach Beep Me. Otherwise the email links to the dashboard answer form. */
  replies?: boolean;
  /** Files that did not fit in the email. The body links to them. */
  links?: OutboundAttachment[];
}

export function renderEmail(message: OutboundMessage, options: EmailOptions = {}): EmailContent {
  return { subject: emailSubject(message, options.subjectPrefix), text: emailText(message, options), html: emailHtml(message, options) };
}

/** "[High] <title> · <agent>", with "[Test]" in front for test messages and the channel's prefix before that. */
export function emailSubject(message: OutboundMessage, prefix?: string): string {
  const tag = `[${PRIORITY_INFO[message.priority].label}]`;
  const subject = `${prefix ? `${prefix} ` : ""}${message.test ? "[Test] " : ""}${tag} ${parts(message).headline}${DOT}${message.agent.name}`;
  return oneLine(subject);
}

/** Email that cannot carry replies points to the dashboard answer form. */
function replyPrompt(message: OutboundMessage, options: EmailOptions): string | null {
  if (!message.options.length && !message.expectReply) return null;
  if (!options.replies) return "Answer in Beep Me.";
  return message.options.length ? "Reply with the number." : "Reply to this email to answer.";
}

function emailText(message: OutboundMessage, options: EmailOptions): string {
  const choices = optionsText(message, Boolean(options.replies));
  const answer = choices && !options.replies ? `${choices}\n${message.appUrl}` : choices;
  const files = options.links?.length ? `Files:\n${options.links.map((file) => `- ${file.name}: ${file.url}`).join("\n")}` : "";
  const footer = message.appUrl.startsWith("https://") ? `View in Beep Me: ${message.appUrl}` : "";
  return [plainText(message), answer, files, footer].filter(Boolean).join("\n\n");
}

function emailHtml(message: OutboundMessage, options: EmailOptions): string {
  const { headline, body } = parts(message);
  const color = PRIORITY_COLOR[message.priority];
  const paragraphs = body
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(paragraph)}</p>`)
    .join("");
  const link = !message.url
    ? ""
    : isHttpUrl(message.url)
      ? `<p style="margin:16px 0 0"><a href="${escapeHtml(message.url)}" style="color:${color}">${escapeHtml(message.url)}</a></p>`
      : `<p style="margin:16px 0 0">${escapeHtml(message.url)}</p>`;
  const app = message.appUrl.startsWith("https://")
    ? `<p style="margin:24px 0 0;font-size:12px;color:#6b7280"><a href="${escapeHtml(message.appUrl)}" style="color:#6b7280">View in Beep Me</a></p>`
    : "";
  const choices = message.options.length
    ? `<ol style="margin:0 0 12px;padding-left:24px">${message.options.map((option) => `<li style="margin:0 0 4px">${escapeHtml(option)}</li>`).join("")}</ol>`
    : "";
  const prompt = replyPrompt(message, options);
  const promptText = prompt && !options.replies ? `<a href="${escapeHtml(message.appUrl)}" style="color:${color}">${escapeHtml(prompt)}</a>` : escapeHtml(prompt ?? "");
  const promptHtml = prompt ? `<p style="margin:0 0 12px;font-weight:600">${promptText}</p>` : "";
  const files = options.links?.length
    ? `<p style="margin:16px 0 4px;font-size:13px;color:#4b5563">Files</p><ul style="margin:0;padding-left:24px">${options.links
        .map((file) => `<li><a href="${escapeHtml(file.url)}" style="color:${color}">${escapeHtml(file.name)}</a></li>`)
        .join("")}</ul>`
    : "";
  return [
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">`,
    `<div style="height:6px;background:${color}"></div>`,
    `<div style="padding:20px 24px">`,
    `<p style="margin:0 0 8px;font-size:13px;color:#4b5563">${escapeHtml(metaLine(message))}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(headline)}</h1>`,
    paragraphs,
    choices,
    promptHtml,
    link,
    files,
    app,
    `</div></div></body></html>`,
  ].join("");
}

/** RFC 2047 B-encoded words, each under 76 characters, split on whole characters. */
export function encodeSubject(subject: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const char of subject.replace(/[\r\n]+/g, " ")) {
    if (utf8(chunk + char).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${base64(utf8(word))}?=`).join("\r\n ");
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export interface PlannedFile {
  attachment: OutboundAttachment;
  /** null when the provider fetches the file from its URL. */
  bytes: Uint8Array | null;
}

/** Attaches files in order while their total stays within `budget` bytes. The rest, and files that fail to load, become links. */
export async function planAttachments(
  attachments: OutboundAttachment[],
  budget: number,
  byUrl: (attachment: OutboundAttachment) => boolean = () => false,
): Promise<{ files: PlannedFile[]; links: OutboundAttachment[] }> {
  const files: PlannedFile[] = [];
  const links: OutboundAttachment[] = [];
  let left = budget;
  for (const attachment of attachments) {
    if (attachment.size !== null && attachment.size > left) {
      links.push(attachment);
    } else if (attachment.size !== null && byUrl(attachment)) {
      files.push({ attachment, bytes: null });
      left -= attachment.size;
    } else {
      const bytes = await attachment.load().catch(() => null);
      if (!bytes || bytes.byteLength > left) {
        links.push(attachment);
        continue;
      }
      files.push({ attachment, bytes });
      left -= bytes.byteLength;
    }
  }
  return { files, links };
}
