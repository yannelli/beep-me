import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readOverlay, writeOverlay, OVERLAY_FILE, type Overlay } from "./overlay.ts";
import { bold, logToStderr, prompt, say } from "./ui.ts";

export const FLAGS = {
  "account-id": { type: "string" },
  emails: { type: "string" },
  domain: { type: "string" },
  alias: { type: "string", multiple: true },
  "workers-dev": { type: "string" },
  "google-client-id": { type: "string" },
  "google-client-secret": { type: "string" },
  "rotate-app-secret": { type: "boolean" },
  record: { type: "string" },
  confirm: { type: "string", multiple: true },
  limit: { type: "string" },
  local: { type: "boolean" },
  yes: { type: "boolean", short: "y" },
  "non-interactive": { type: "boolean" },
  "dry-run": { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export type Flags = ReturnType<typeof parseArgs<{ options: typeof FLAGS; allowPositionals: true }>>["values"];

export interface Ctx {
  root: string;
  flags: Flags;
  interactive: boolean;
  dryRun: boolean;
  json: boolean;
  accountId?: string;
  overlay: Overlay;
  missing: { input: string; why: string }[];
}

export class UsageError extends Error {}

export function createContext(argv: string[]): { ctx: Ctx; positionals: string[] } {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: FLAGS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values: flags, positionals } = parsed;
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const headless = !process.stdin.isTTY || !process.stdout.isTTY || Boolean(process.env.CI) || Boolean(flags.yes || flags["non-interactive"]);
  if (flags.json) logToStderr();
  const ctx: Ctx = {
    root,
    flags,
    interactive: !headless && !flags.json,
    dryRun: Boolean(flags["dry-run"]),
    json: Boolean(flags.json),
    overlay: readOverlay(root),
    missing: [],
  };
  return { ctx, positionals };
}

/** Records a required input that headless mode did not get. */
export function need(ctx: Ctx, input: string, why: string): void {
  ctx.missing.push({ input, why });
}

export function exitIfMissing(ctx: Ctx): void {
  if (!ctx.missing.length) return;
  process.stderr.write(`${bold("Missing input.")} Headless mode does not ask questions. Add these and run again:\n`);
  const width = Math.max(...ctx.missing.map((entry) => entry.input.length));
  for (const entry of ctx.missing) process.stderr.write(`  ${entry.input.padEnd(width)}  ${entry.why}\n`);
  process.exit(2);
}

/** Headless changes need --yes, unless this is a dry run. */
export function requireYes(ctx: Ctx): void {
  if (!ctx.interactive && !ctx.flags.yes && !ctx.dryRun) need(ctx, "--yes", "allow the changes in this run");
}

export function saveOverlay(ctx: Ctx, patch: Partial<Overlay>): void {
  ctx.overlay = { ...ctx.overlay, ...patch };
  if (ctx.dryRun) return say.dryRun(`write ${OVERLAY_FILE}: ${JSON.stringify(patch)}`);
  writeOverlay(ctx.root, ctx.overlay);
}

export function confirmValue(ctx: Ctx, value: string): boolean {
  return (ctx.flags.confirm ?? []).includes(value);
}

/** Asks before a change. Headless runs got --yes or --dry-run before any change started. */
export async function approve(ctx: Ctx, message: string, initial = true): Promise<boolean> {
  return ctx.interactive ? prompt.confirm(message, initial) : true;
}

/** Destructive actions need the typed word, or --confirm <word> in headless mode, even with --yes. */
export async function approveDestructive(ctx: Ctx, message: string, word: string): Promise<boolean> {
  if (!ctx.interactive) {
    if (confirmValue(ctx, word) || ctx.dryRun) return true;
    need(ctx, `--confirm ${word}`, message);
    exitIfMissing(ctx);
  }
  say.warn(message);
  const typed = await prompt.text(`Type ${bold(word)} to confirm, or leave it empty to cancel`);
  return typed === word;
}
