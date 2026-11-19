import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approve, approveDestructive, exitIfMissing, requireYes, type Ctx } from "./context.ts";
import { listCustomDomains, workersDevUrl, workerSecrets, type WorkerSecrets } from "./cloudflare.ts";
import { customDomains, publicUrl } from "./overlay.ts";
import { bold, dim, prompt, say, spin } from "./ui.ts";
import { failure, run, wrangler, WORKER } from "./wrangler.ts";

export interface Secrets {
  APP_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

/** Primary address: the custom domain when set, otherwise workers.dev. */
export async function primaryUrl(ctx: Ctx): Promise<string> {
  return publicUrl(ctx.overlay) ?? (await workersDevUrl(ctx)) ?? `https://${WORKER}.<your-subdomain>.workers.dev`;
}

/** APP_SECRET encrypts stored channel keys and signs sessions, so replacing it needs a typed confirmation. */
export async function appSecretStep(ctx: Ctx, secrets: WorkerSecrets): Promise<Secrets> {
  if (!secrets.names.has("APP_SECRET")) {
    say.info("APP_SECRET is missing. Setup generates a random 64-character value and uploads it with the deploy.");
    return { APP_SECRET: randomBytes(32).toString("hex") };
  }
  if (!ctx.flags["rotate-app-secret"]) {
    say.skip("APP_SECRET found. Keeping it.");
    return {};
  }
  const warning =
    "Replacing APP_SECRET makes every stored channel key unreadable and signs everyone out. You must enter each channel's keys again.";
  if (!(await approveDestructive(ctx, warning, "rotate"))) {
    say.skip("Kept APP_SECRET.");
    return {};
  }
  return { APP_SECRET: randomBytes(32).toString("hex") };
}

function build(ctx: Ctx): void {
  const progress = spin("Building the dashboard and Worker");
  const result = run(ctx, "vite", ["build"], { write: true });
  if (!result.ok) {
    progress.fail("Build failed.");
    process.stderr.write(`${result.stdout}\n${result.stderr}`.trim().split("\n").slice(-30).join("\n") + "\n");
    throw new Error("Fix the build error above. Then run the command again.");
  }
  progress.done(ctx.dryRun ? "Build skipped." : "Built.");
}

async function checkDomainOwners(ctx: Ctx): Promise<void> {
  const hosts = customDomains(ctx.overlay);
  if (!hosts.length) return;
  const taken = (await listCustomDomains(ctx)).filter((domain) => hosts.includes(domain.hostname) && domain.service !== WORKER);
  if (taken.length) {
    throw new Error(`${taken.map((domain) => `${domain.hostname} serves "${domain.service}"`).join(", ")}. Without a terminal, Wrangler would move it to Beep Me. Remove it from that Worker first.`);
  }
}

/** Builds with the overlay and deploys. Interactive deploys keep the terminal, so Wrangler can ask about domain conflicts. */
export async function deployStep(ctx: Ctx, upload: Secrets): Promise<boolean> {
  const names = Object.keys(upload);
  const extra = names.length ? ` and upload ${names.join(", ")}` : "";
  if (!(await approve(ctx, `Build and deploy ${bold(WORKER)}${extra}?`))) {
    say.skip("Skipped the deploy. Run bun run cli deploy later.");
    return false;
  }
  if (!ctx.dryRun && (!ctx.overlay.databaseId || !ctx.overlay.kvNamespaceId)) {
    throw new Error("The D1 or KV id is missing, and Wrangler would create new resources. Run bun run setup first.");
  }
  if (!ctx.interactive) await checkDomainOwners(ctx);
  build(ctx);
  const dir = mkdtempSync(join(tmpdir(), "beep-me-"));
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify(upload), { mode: 0o600 });
  try {
    const args = ["deploy", ...(names.length ? ["--secrets-file", file] : [])];
    const shown = `deploy${names.length ? ` --secrets-file <${names.join(", ")}>` : ""}`;
    const result = wrangler(ctx, args, { write: true, deployConfig: true, inherit: ctx.interactive, shown });
    if (!result.ok) throw new Error(`Deploy failed: ${ctx.interactive ? "see the Wrangler output above." : failure(result)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!ctx.dryRun) say.ok(`Deployed to ${bold(await primaryUrl(ctx))}`);
  return true;
}

export function putSecrets(ctx: Ctx, values: Secrets): void {
  const names = Object.keys(values).join(", ");
  const result = wrangler(ctx, ["secret", "bulk", "--name", WORKER], { write: true, input: JSON.stringify(values), shown: `secret bulk --name ${WORKER} <stdin: ${names}>` });
  if (!result.ok) throw new Error(`Could not save ${names}: ${failure(result)}`);
  if (!ctx.dryRun) say.ok(`Saved ${names}.`);
}

/** Reads the Google client from flags or env in headless mode. Returns null when the user skips it. */
export async function googleStep(ctx: Ctx, secrets: WorkerSecrets, replace = false): Promise<Secrets | null> {
  const hasClient = secrets.names.has("GOOGLE_CLIENT_ID") && secrets.names.has("GOOGLE_CLIENT_SECRET");
  const flagId = ctx.flags["google-client-id"] ?? process.env.BEEPME_GOOGLE_CLIENT_ID;
  const flagSecret = ctx.flags["google-client-secret"] ?? process.env.BEEPME_GOOGLE_CLIENT_SECRET;
  if (hasClient && !replace && !flagId) {
    say.skip("Google sign-in client found. Skipping.");
    return null;
  }
  const origin = await primaryUrl(ctx);
  if (!ctx.interactive) {
    if (!flagId || !flagSecret) {
      say.warn(`Google sign-in is not set. Add the redirect URI ${origin}/auth/google/callback to a Google client. Then run bun run cli google.`);
      return null;
    }
    const values = { GOOGLE_CLIENT_ID: flagId, GOOGLE_CLIENT_SECRET: flagSecret };
    putSecrets(ctx, values);
    return values;
  }
  say.note(
    [
      `1. Open ${bold("https://console.cloud.google.com/auth/clients/create")}`,
      `2. Application type: ${bold("Web application")}. Name: Beep Me.`,
      `3. Authorized redirect URI: ${bold(`${origin}/auth/google/callback`)}`,
      "4. Select Create. Copy the client ID and the client secret.",
      dim("For the Gmail channel, also turn on the Gmail API:"),
      dim("https://console.cloud.google.com/apis/library/gmail.googleapis.com"),
    ].join("\n"),
    "Create a Google sign-in client",
  );
  if (!(await prompt.confirm("Do you have the client ID and secret now?"))) {
    say.skip("Skipped. Run bun run cli google when you have them.");
    return null;
  }
  const values = { GOOGLE_CLIENT_ID: await prompt.text("Client ID"), GOOGLE_CLIENT_SECRET: await prompt.password("Client secret") };
  putSecrets(ctx, values);
  return values;
}

export async function deployCommand(ctx: Ctx): Promise<void> {
  requireYes(ctx);
  exitIfMissing(ctx);
  const secrets = workerSecrets(ctx);
  const upload = secrets.names.has("APP_SECRET") ? {} : await appSecretStep(ctx, secrets);
  await deployStep(ctx, upload);
}
