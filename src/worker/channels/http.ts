export interface HttpResponse {
  ok: boolean;
  /** 0 when the request did not complete (network error or timeout). */
  status: number;
  headers: Headers;
  text: string;
  json: unknown;
}

export interface HttpInit extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRY_WAIT_MS = 3_000;
const MAX_DETAIL = 300;

/** Fetch with a timeout and one retry on 429/5xx. Resolves with status 0 on network failure and does not include the URL in any text. */
export async function http(url: string, init: HttpInit = {}): Promise<HttpResponse> {
  const first = await attempt(url, init);
  if (first.status !== 429 && first.status < 500) return first;
  await sleep(retryWaitMs(first.headers));
  return attempt(url, init);
}

async function attempt(url: string, init: HttpInit): Promise<HttpResponse> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
    text = await response.text();
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const reason = timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s` : "network error";
    return { ok: false, status: 0, headers: new Headers(), text: `Request ${reason}`, json: null };
  }
  return { ok: response.ok, status: response.status, headers: response.headers, text, json: parseJson(text) };
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function retryWaitMs(headers: Headers): number {
  const header = headers.get("retry-after");
  if (!header) return 1_000;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Math.min(Math.max(ms, 0), MAX_RETRY_WAIT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pulls the provider's own error text out of a JSON or text body. */
export function errorText(response: HttpResponse): string {
  const fromJson = messageFromJson(response.json);
  const text = fromJson ?? (response.json === null ? response.text.trim() : "");
  if (text && !/^\s*</.test(text)) return clip(text);
  return response.status === 0 ? response.text : `HTTP ${response.status}`;
}

function messageFromJson(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  if (!isRecord(value)) return null;
  if (Array.isArray(value.errors) && value.errors.length > 0) {
    const first: unknown = value.errors[0];
    if (typeof first === "string") return first;
    if (isRecord(first)) return [first.title, first.detail ?? first.message].filter(isText).join(": ") || null;
  }
  for (const key of ["message", "description", "error_description", "detail", "error"]) {
    const field = value[key];
    if (isText(field)) return field;
    if (isRecord(field)) return messageFromJson(field);
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Cuts to at most `max` UTF-16 units with an ellipsis, without splitting a surrogate pair. */
export function clip(text: string, max = MAX_DETAIL): string {
  if (text.length <= max) return text;
  let out = "";
  for (const char of text) {
    if (out.length + char.length > max - 1) break;
    out += char;
  }
  return `${out}${ELLIPSIS}`;
}

const ELLIPSIS = "…";

/** Cuts so that the summed `measure` of the result, ellipsis included, stays within `max`. */
export function clipBy(text: string, max: number, measure: (char: string) => number): string {
  const chars = Array.from(text);
  if (chars.reduce((sum, char) => sum + measure(char), 0) <= max) return text;
  let out = "";
  let used = measure(ELLIPSIS);
  for (const char of chars) {
    used += measure(char);
    if (used > max) break;
    out += char;
  }
  return `${out}${ELLIPSIS}`;
}

const encoder = new TextEncoder();

export function utf8Length(char: string): number {
  return encoder.encode(char).length;
}

export function basicAuth(user: string, password: string): string {
  return `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`;
}

export function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value);
}
