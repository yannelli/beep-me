import { PRIORITY_INFO } from "../../shared/priority";
import { isHttpUrl } from "./http";
import { DOT, PRIORITY_COLOR, escapeHtml, metaLine, oneLine, parts, plainText } from "./render";
import type { OutboundMessage } from "./types";

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export function renderEmail(message: OutboundMessage): EmailContent {
  return { subject: emailSubject(message), text: emailText(message), html: emailHtml(message) };
}

/** "[High] <title> · <agent>", with "[Test]" in front for test messages. */
export function emailSubject(message: OutboundMessage): string {
  const tag = `[${PRIORITY_INFO[message.priority].label}]`;
  const subject = `${message.test ? "[Test] " : ""}${tag} ${parts(message).headline}${DOT}${message.agent.name}`;
  return oneLine(subject);
}

function emailText(message: OutboundMessage): string {
  const footer = message.appUrl.startsWith("https://") ? `\n\nView in Beep Me: ${message.appUrl}` : "";
  return `${plainText(message)}${footer}`;
}

function emailHtml(message: OutboundMessage): string {
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
  return [
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111827">`,
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">`,
    `<div style="height:6px;background:${color}"></div>`,
    `<div style="padding:20px 24px">`,
    `<p style="margin:0 0 8px;font-size:13px;color:#4b5563">${escapeHtml(metaLine(message))}</p>`,
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(headline)}</h1>`,
    paragraphs,
    link,
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
