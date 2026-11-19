import { PRIORITY_INFO } from "../../shared/priority";
import { oneLine, parts, topicTag } from "./render";
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

function toGsm(text: string): string {
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

/** "Beep Me: Claude Code (High, #api)" then the headline, body and link, kept within two SMS segments. */
export function smsText(message: OutboundMessage): string {
  const { headline, body } = parts(message);
  const tags = [PRIORITY_INFO[message.priority].label, topicTag(message)].filter(Boolean).join(", ");
  const header = `${message.test ? "TEST " : ""}Beep Me: ${oneLine(message.agent.name)} (${tags})`;
  const text = toGsm([header, headline, body].filter(Boolean).join("\n")).trim();
  const url = message.url ? `\n${message.url}` : "";
  const gsm = Array.from(text + url).every((char) => gsmUnits(char) !== null);
  const max = gsm ? GSM_TWO_SEGMENTS : UCS2_TWO_SEGMENTS;
  const measure = gsm ? (char: string) => gsmUnits(char) ?? 1 : (char: string) => char.length;
  const urlCost = Array.from(url).reduce((sum, char) => sum + measure(char), 0);
  if (url && urlCost <= max / 2) return truncate(text, max - urlCost, measure) + url;
  return truncate(text + url, max, measure);
}
