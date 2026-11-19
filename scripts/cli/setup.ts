import { execFileSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { exitIfMissing, need, requireYes, saveOverlay, type Ctx } from "./context.ts";
import { ensureDatabase, ensureNamespace, signIn, workerSecrets, type Account } from "./cloudflare.ts";
import { appSecretStep, deployCommand, deployStep, googleStep, primaryUrl, type Secrets } from "./deploy.ts";
import { configureDomain } from "./domain.ts";
import { OVERLAY_FILE } from "./overlay.ts";
import { bold, dim, prompt, say } from "./ui.ts";
import { DB_NAME, KV_TITLE, WORKER } from "./wrangler.ts";

function gitEmail(): string {
  try {
    return execFileSync("git", ["config", "user.email"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function describeEmails(value: string): string {
  if (value === "*") return "any Google account";
  return value ? value : "only the first account that signs in";
}

/** Sets ALLOWED_EMAILS. Returns true when it changed. */
export async function emailsStep(ctx: Ctx): Promise<boolean> {
  const current = ctx.overlay.allowedEmails;
  let next = ctx.flags.emails?.trim() ?? current;
  if (ctx.interactive) {
    if (current !== undefined && !(await prompt.confirm(`Sign-in is open to ${bold(describeEmails(current))}. Change it?`, false))) {
      say.skip("Kept the sign-in list.");
      return false;
    }
    say.info(`Enter Google account emails, comma-separated. ${dim('Enter * for any account. Leave it empty to allow only the first account that signs in.')}`);
    next = await prompt.text("Who can sign in?", { initial: current ?? gitEmail() });
  }
  if (next === undefined) {
    need(ctx, "--emails <list>", 'Google accounts that can sign in. Use "*" for any account, or "" for the first account that signs in.');
    return false;
  }
  next = next.split(",").map((email) => email.trim()).filter(Boolean).join(",");
  if (next === current) {
    say.skip(`Sign-in list found: ${describeEmails(next)}. Skipping.`);
    return false;
  }
  saveOverlay(ctx, { allowedEmails: next });
  say.ok(`Sign-in open to ${describeEmails(next)}.`);
  return true;
}

export function connectText(origin: string): string {
  return [
    `Dashboard: ${bold(origin)}`,
    `Docs: ${origin}/docs`,
    "",
    "Claude Code:",
    `  claude mcp add --transport http --scope user beep-me ${origin}/mcp`,
    "Claude (web, desktop, mobile):",
    `  Customize > Connectors > + Add > Add custom connector > ${origin}/mcp`,
  ].join("\n");
}

function writeRecord(ctx: Ctx, path: string, account: Account, origin: string, saved: Secrets): void {
  const secret = (name: keyof Secrets) => saved[name] ?? "(not changed in this run, not shown)";
  const lines = [
    `# Beep Me deployment`,
    "",
    `Written ${new Date().toISOString()} by bun run setup. This file holds secrets.`,
    "",
    "| Item | Value |",
    "| --- | --- |",
    `| Account | ${account.name} (${account.id}) |`,
    `| Worker | ${WORKER} |`,
    `| URL | ${origin} |`,
    `| Aliases | ${(ctx.overlay.aliases ?? []).join(", ") || "none"} |`,
    `| D1 database | ${DB_NAME} (${ctx.overlay.databaseId ?? "unknown"}) |`,
    `| KV namespace | ${KV_TITLE} (${ctx.overlay.kvNamespaceId ?? "unknown"}) |`,
    `| ALLOWED_EMAILS | ${ctx.overlay.allowedEmails || "(empty)"} |`,
    `| APP_SECRET | \`${secret("APP_SECRET")}\` |`,
    `| GOOGLE_CLIENT_ID | \`${secret("GOOGLE_CLIENT_ID")}\` |`,
    `| GOOGLE_CLIENT_SECRET | \`${secret("GOOGLE_CLIENT_SECRET")}\` |`,
    `| Google redirect URI | ${origin}/auth/google/callback |`,
    "",
    "```sh",
    `claude mcp add --transport http --scope user beep-me ${origin}/mcp`,
    "```",
    "",
  ];
  if (ctx.dryRun) return say.dryRun(`write the deployment record to ${path} (mode 600)`);
  writeFileSync(path, lines.join("\n"), { mode: 0o600 });
  chmodSync(path, 0o600);
  say.ok(`Saved the deployment record to ${path} (mode 600).`);
}

async function recordPath(ctx: Ctx): Promise<string | null> {
  if (ctx.flags.record) return resolve(ctx.flags.record.replace(/^~(?=\/)/, homedir()));
  if (!ctx.interactive || !(await prompt.confirm("Save a deployment record with the secrets from this run to a Markdown file?", false))) return null;
  return resolve((await prompt.text("File path", { initial: "~/beep-me-deployment.md" })).replace(/^~(?=\/)/, homedir()));
}

export async function setup(ctx: Ctx): Promise<void> {
  say.intro("Beep Me setup");
  if (ctx.dryRun) say.warn("Dry run. Setup reads your account and prints each change. It changes nothing.");
  if (!ctx.interactive) {
    if (ctx.flags.emails === undefined && ctx.overlay.allowedEmails === undefined) {
      need(ctx, "--emails <list>", 'Google accounts that can sign in. Use "*" for any account.');
    }
    requireYes(ctx);
  }
  say.step("1. Cloudflare account");
  const account = await signIn(ctx, { persist: true });
  exitIfMissing(ctx);
  say.ok(`Using ${bold(account.name)} ${dim(account.id)}`);
  const secrets = workerSecrets(ctx);

  say.step("2. Database");
  await ensureDatabase(ctx);
  say.step("3. Sign-in storage");
  await ensureNamespace(ctx);
  say.step("4. Who can sign in");
  await emailsStep(ctx);
  exitIfMissing(ctx);
  say.step("5. Address");
  await configureDomain(ctx);
  say.step("6. App secret");
  const upload = await appSecretStep(ctx, secrets);
  say.step("7. Deploy");
  const deployed = await deployStep(ctx, upload);
  say.step("8. Google sign-in");
  const google = deployed || secrets.deployed ? await googleStep(ctx, secrets) : null;
  if (!deployed && !secrets.deployed) say.skip("Skipped. Deploy first, then run bun run cli google.");

  say.step("9. Done");
  const origin = await primaryUrl(ctx);
  say.block("Beep Me is ready", connectText(origin));
  say.info(`Next: open ${origin} on your phone, sign in with Google, add a channel, and select Test.`);
  say.info(dim(`Deployment values are in ${OVERLAY_FILE}. Manage this deployment with bun run cli.`));
  const path = await recordPath(ctx);
  if (path) writeRecord(ctx, path, account, origin, { ...upload, ...(google ?? {}) });
  say.outro(ctx.dryRun ? "Dry run finished. Nothing changed." : "Setup finished.");
}

export async function emailsCommand(ctx: Ctx): Promise<void> {
  if (!ctx.interactive && ctx.flags.emails === undefined) need(ctx, "--emails <list>", "the new sign-in list");
  requireYes(ctx);
  exitIfMissing(ctx);
  if (await emailsStep(ctx)) await deployCommand(ctx);
}
