const QUOTE_START = [
  /^On .{1,300} wrote:$/,
  /^-{2,} ?Original Message ?-{2,}$/i,
  /^_{10,}$/,
  /^>/,
  /^-- ?$/,
  /^Sent from my /i,
  /^Get Outlook for /i,
];
const OUTLOOK_FIELD = /^(Sent|Date|To|Subject|Cc):/i;

/** Keeps what the person wrote: cuts at the quoted original, the "On ... wrote:" line, or the signature. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const next = lines.slice(index + 1, index + 4).map((value) => value.trim());
    const wrappedWrote = /^On /.test(line) && /wrote:$/.test(`${line} ${next[0] ?? ""}`) && !/wrote:$/.test(line);
    const outlookHeader = /^From: /.test(line) && next.some((value) => OUTLOOK_FIELD.test(value));
    if (QUOTE_START.some((pattern) => pattern.test(line)) || wrappedWrote || outlookHeader) break;
    kept.push(raw.trimEnd());
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Plain text from an HTML-only reply. Drops the quoted part that mail apps wrap in a blockquote or a quote div. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<div[^>]*class="[^"]*(gmail_quote|moz-cite-prefix|OutlookMessageHeader)[\s\S]*$/i, "")
    .replace(/<blockquote[\s\S]*$/i, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, code: string) => {
      if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(parseInt(code.slice(2), 16));
      if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
      return ENTITIES[code.toLowerCase()] ?? entity;
    })
    .replace(/[ \t]+\n/g, "\n");
}

/** A one-line reply of "2", "2.", "#2", or the option text picks that option. */
export function parseChoice(text: string, options: string[]): number | null {
  if (!options.length || text.includes("\n")) return null;
  const answer = text.trim().replace(/[.)!]+$/, "");
  const number = /^(?:#|option\s*)?(\d{1,2})$/i.exec(answer);
  if (number) {
    const index = Number(number[1]) - 1;
    return index >= 0 && index < options.length ? index : null;
  }
  const index = options.findIndex((option) => option.toLowerCase() === answer.toLowerCase());
  return index >= 0 ? index : null;
}

/** Header fields of a raw RFC 822 message, lowercased and unfolded. */
export function parseHeaderBlock(raw: string): Record<string, string> {
  const end = raw.search(/\r?\n\r?\n/);
  const block = (end >= 0 ? raw.slice(0, end) : raw).replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] ??= line.slice(colon + 1).trim();
  }
  return headers;
}
