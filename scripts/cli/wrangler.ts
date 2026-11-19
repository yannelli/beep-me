import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { Ctx } from "./context.ts";
import { say } from "./ui.ts";

export const WORKER = "beep-me";
export const DB_NAME = "beep-me";
export const KV_TITLE = "beep-me-oauth";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Changes something on Cloudflare or on disk. Dry runs print it and skip it. */
  write?: boolean;
  input?: string;
  inherit?: boolean;
  /** Use the build's redirected config (deploy). Other commands read wrangler.jsonc so a stale build cannot pick the account. */
  deployConfig?: boolean;
  /** Text shown in place of the arguments, to keep secrets out of logs. */
  shown?: string;
}

function childEnv(ctx: Ctx): NodeJS.ProcessEnv {
  return ctx.accountId ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: ctx.accountId } : { ...process.env };
}

export function run(ctx: Ctx, bin: string, args: string[], options: RunOptions = {}): RunResult {
  const shown = options.shown ?? `${bin} ${args.join(" ")}`;
  if (options.write && ctx.dryRun) {
    say.dryRun(shown);
    return { ok: true, stdout: "", stderr: "" };
  }
  if (ctx.dryRun) say.command(shown);
  const result = spawnSync(join(ctx.root, "node_modules/.bin", bin), args, {
    cwd: ctx.root,
    env: childEnv(ctx),
    encoding: "utf8",
    input: options.input,
    stdio: options.inherit ? "inherit" : "pipe",
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function wrangler(ctx: Ctx, args: string[], options: RunOptions = {}): RunResult {
  const config = options.deployConfig ? [] : ["--config", "wrangler.jsonc"];
  return run(ctx, "wrangler", [...args, ...config], { ...options, shown: `wrangler ${options.shown ?? args.join(" ")}` });
}

export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text.trim()) as T;
  } catch {
    return null;
  }
}

export function failure(result: RunResult): string {
  const text = `${result.stderr}\n${result.stdout}`.replace(/\x1b\[[0-9;]*m/g, "");
  const line = text.split("\n").find((entry) => /ERROR|error|✘/.test(entry)) ?? text.trim().split("\n")[0] ?? "";
  return line.replace(/^.*\[ERROR\]\s*/, "").replace(/^✘\s*/, "").trim() || "Wrangler failed without a message.";
}

let cachedToken: string | undefined;

function apiToken(ctx: Ctx): string | null {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  if (cachedToken) return cachedToken;
  const result = wrangler(ctx, ["auth", "token", "--json"]);
  cachedToken = parseJson<{ token?: string }>(result.stdout)?.token;
  return cachedToken ?? null;
}

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  result: T | null;
  error?: string;
}

/** Cloudflare API with Wrangler's login. Any method other than GET counts as a write. */
export async function api<T>(ctx: Ctx, path: string, method = "GET"): Promise<ApiResult<T>> {
  if (method !== "GET" && ctx.dryRun) {
    say.dryRun(`${method} https://api.cloudflare.com/client/v4${path}`);
    return { ok: true, status: 0, result: null };
  }
  if (ctx.dryRun) say.command(`${method} /client/v4${path}`);
  const token = apiToken(ctx);
  if (!token) return { ok: false, status: 0, result: null, error: "No Cloudflare token. Run wrangler login." };
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { authorization: `Bearer ${token}` } });
  const body = (await response.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message: string }[] } | null;
  return { ok: response.ok && Boolean(body?.success), status: response.status, result: body?.result ?? null, error: body?.errors?.[0]?.message };
}

export function sql(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(Math.trunc(value));
  return `'${value.replaceAll("'", "''")}'`;
}

export interface QueryResult<T> {
  ok: boolean;
  rows: T[];
  error?: string;
}

/** Runs SQL on the deployed D1 database, or on local dev state with --local. */
export function query<T>(ctx: Ctx, statement: string, options: { write?: boolean } = {}): QueryResult<T> {
  const target = ctx.flags.local ? ["--local"] : ["--remote"];
  const result = wrangler(ctx, ["d1", "execute", DB_NAME, ...target, "--json", "--yes", "--command", statement], {
    write: options.write,
    shown: `d1 execute ${DB_NAME} ${target.join(" ")} --json --command "${statement}"`,
  });
  if (options.write && ctx.dryRun) return { ok: true, rows: [] };
  const parsed = parseJson<{ results?: T[]; error?: { text?: string } } | { results?: T[] }[]>(result.stdout);
  if (Array.isArray(parsed) && result.ok) return { ok: true, rows: parsed.flatMap((entry) => entry.results ?? []) };
  const error = !Array.isArray(parsed) && parsed?.error?.text ? parsed.error.text : failure(result);
  return { ok: false, rows: [], error };
}
