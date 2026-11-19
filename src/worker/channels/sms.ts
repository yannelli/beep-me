import { PRIORITY_INFO } from "../../shared/priority";
import { oneLine, optionsText, parts, senderLabel, topicTag } from "./render";
import type { HttpResponse } from "./http";
import type { OutboundMessage } from "./types";

// GSM-7 keeps a segment at 153 characters; one emoji or "·" switches the whole text to UCS-2 (67 per segment).
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENDED = new Set("^{}\\[~]|€");
const GSM_TWO_SEGMENTS = 306;
const UCS2_TWO_SEGMENTS = 134;

const REPLACEMENTS: [RegExp, string][] = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[‐-―−]/g, "-"],
  [/…/g, "..."],
  [/[   \t]/g, " "],
  [/[·•]/g, "-"],
  [/×/g, "x"],
  [/[\p{Extended_Pictographic}️‍]/gu, ""],
];

export function toGsm(text: string): string {
  return REPLACEMENTS.reduce((out, [pattern, value]) => out.replace(pattern, value), text).replace(/ {2,}/g, " ");
}

function gsmUnits(char: string): number | null {
  if (GSM_BASIC.has(char)) return 1;
  if (GSM_EXTENDED.has(char)) return 2;
  return null;
}

function truncate(text: string, max: number, measure: (char: string) => number): string {
  const chars = Array.from(text);
  if (chars.reduce((sum, char) => sum + measure(char), 0) <= max) return text;
  let out = "";
  let used = 3;
  for (const char of chars) {
    if (used + measure(char) > max) break;
    used += measure(char);
    out += char;
  }
  return `${out.trimEnd()}...`;
}

// "Beep Me: Claude Code (High, #api)", headline, body, link, file links, and choices, within two SMS segments.
// Choices and links stay whole while they fit in two thirds of the limit; the body is cut first.
export function smsText(message: OutboundMessage, fileLinks: string[] = []): string {
  const { headline, body } = parts(message);
  const tags = [PRIORITY_INFO[message.priority].label, topicTag(message)].filter(Boolean).join(", ");
  const header = `${message.test ? "TEST " : ""}Beep Me: ${oneLine(senderLabel(message))} (${tags})`;
  const text = toGsm([header, headline, body].filter(Boolean).join("\n")).trim();
  const choices = optionsText(message);
  const choiceLine = choices ? toGsm(choices) : "";
  const links = [message.url, ...fileLinks].filter((link): link is string => Boolean(link));
  const gsm = Array.from([text, choiceLine, ...links].join("")).every((char) => gsmUnits(char) !== null);
  const max = gsm ? GSM_TWO_SEGMENTS : UCS2_TWO_SEGMENTS;
  const measure = gsm ? (char: string) => gsmUnits(char) ?? 1 : (char: string) => char.length;
  const cost = (line: string) => Array.from(line).reduce((sum, char) => sum + measure(char), 1);
  let budget = Math.floor((max * 2) / 3);
  const tailChoice = choiceLine ? truncate(choiceLine, Math.max(budget - 1, 0), measure) : "";
  budget -= tailChoice ? cost(tailChoice) : 0;
  const kept: string[] = [];
  const cut: string[] = [];
  for (const link of links) {
    if (cost(link) <= budget) {
      kept.push(link);
      budget -= cost(link);
    } else cut.push(link);
  }
  const tail = [...kept, tailChoice].filter(Boolean);
  const tailCost = tail.reduce((sum, line) => sum + cost(line), 0);
  const head = truncate([text, ...cut].join("\n"), max - tailCost, measure);
  return [head, ...tail].join("\n");
}

export interface MmsLimits {
  maxFiles: number;
  maxTotalBytes: number;
  /** MIME types the provider sends as MMS media. */
  accepts(mime: string): boolean;
  /** Destinations that get MMS. Files to other numbers become links. */
  reaches(to: string): boolean;
}

/** Images first, then other files the provider accepts, as MMS media. The rest become links in the text. */
export function splitAttachments(message: OutboundMessage, to: string, limits: MmsLimits): { mediaUrls: string[]; links: string[] } {
  const mediaUrls: string[] = [];
  const links: string[] = [];
  let total = 0;
  const ordered = [...message.attachments].sort((a, b) => Number(b.kind === "image") - Number(a.kind === "image"));
  for (const file of ordered) {
    const size = file.size ?? 0;
    const fits = mediaUrls.length < limits.maxFiles && total + size <= limits.maxTotalBytes;
    if (limits.reaches(to) && /^https:\/\//i.test(file.url) && limits.accepts(file.mime) && fits) {
      mediaUrls.push(file.url);
      total += size;
    } else links.push(file.url);
  }
  return { mediaUrls, links };
}

/** A 4xx on a send with media. Files without a known size can break the provider's MMS limits, so the adapter retries with links. */
export function isMediaRejection(response: HttpResponse, mediaUrls: string[]): boolean {
  return mediaUrls.length > 0 && response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403;
}

/** Downloads provider media with `headers`, then follows one redirect without them (CDN links are presigned). */
export async function fetchProviderMedia(url: string, headers: Record<string, string> | undefined): Promise<Response> {
  const first = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const location = first.headers.get("location");
  if (first.status < 300 || first.status >= 400 || !location) return first;
  return fetch(new URL(location, url), { signal: AbortSignal.timeout(20_000) });
}
