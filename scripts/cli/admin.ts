import { spawn } from "node:child_process";
import { approve, approveDestructive, exitIfMissing, need, requireYes, saveOverlay, type Ctx } from "./context.ts";
import { listDatabases, listNamespaces, workerSecrets } from "./cloudflare.ts";
import { deployCommand, googleStep, primaryUrl } from "./deploy.ts";
import { configureDomain, domainChangeNote } from "./domain.ts";
import { connectText } from "./setup.ts";
import { bold, say } from "./ui.ts";
import { DB_NAME, failure, KV_TITLE, wrangler, WORKER } from "./wrangler.ts";

export async function googleCommand(ctx: Ctx): Promise<void> {
  const secrets = workerSecrets(ctx);
  if (!secrets.deployed) throw new Error("Beep Me is not deployed yet. Run bun run setup first.");
  if (!ctx.interactive) {
    if (!(ctx.flags["google-client-id"] ?? process.env.BEEPME_GOOGLE_CLIENT_ID)) need(ctx, "--google-client-id or BEEPME_GOOGLE_CLIENT_ID", "the new client ID");
    if (!(ctx.flags["google-client-secret"] ?? process.env.BEEPME_GOOGLE_CLIENT_SECRET)) need(ctx, "BEEPME_GOOGLE_CLIENT_SECRET or --google-client-secret", "the new client secret");
    requireYes(ctx);
    exitIfMissing(ctx);
  }
  await googleStep(ctx, secrets, true);
}

export async function domainCommand(ctx: Ctx): Promise<void> {
  if (!ctx.interactive) {
    requireYes(ctx);
    exitIfMissing(ctx);
  }
  const before = await primaryUrl(ctx);
  if (!(await configureDomain(ctx))) return;
  const after = await primaryUrl(ctx);
  const secrets = workerSecrets(ctx);
  if (secrets.deployed) await deployCommand(ctx);
  else say.info("Run bun run setup to deploy.");
  if (secrets.deployed && before !== after) say.block(`Beep Me moves to ${after}`, domainChangeNote(after));
}

export function logs(ctx: Ctx): void {
  say.info(`Logs from ${WORKER} show here. Press Ctrl+C to stop.`);
  if (ctx.dryRun) return say.command(`wrangler tail ${WORKER} --format pretty`);
  wrangler(ctx, ["tail", WORKER, "--format", "pretty"], { inherit: true });
}

export async function open(ctx: Ctx): Promise<void> {
  const url = await primaryUrl(ctx);
  if (ctx.json) return void process.stdout.write(`${JSON.stringify({ url })}\n`);
  say.info(`Dashboard: ${bold(url)}`);
  if (!ctx.interactive || ctx.dryRun) return;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}

export async function connect(ctx: Ctx): Promise<void> {
  const origin = await primaryUrl(ctx);
  if (ctx.json) return void process.stdout.write(`${JSON.stringify({ mcpUrl: `${origin}/mcp`, claudeCode: `claude mcp add --transport http --scope user beep-me ${origin}/mcp` })}\n`);
  say.block("Connect an agent", connectText(origin));
  say.info("Other MCP clients: add a remote server with the URL above ending in /mcp. Sign in with Google when the client asks.");
}

/** Deletes the Worker, then the database and namespace. Each step needs the earlier one to finish. */
export async function teardown(ctx: Ctx): Promise<void> {
  requireYes(ctx);
  exitIfMissing(ctx);
  const message = `Delete the ${WORKER} Worker, the ${DB_NAME} database, and the ${KV_TITLE} namespace? All messages, channels, and agents are lost.`;
  if (!(await approveDestructive(ctx, message, WORKER))) return say.skip("Canceled. Nothing was deleted.");
  if (workerSecrets(ctx).deployed) {
    const result = wrangler(ctx, ["delete", WORKER], { write: true });
    if (!result.ok) throw new Error(`Could not delete the Worker: ${failure(result)}`);
    if (!ctx.dryRun) say.ok(`Deleted the ${WORKER} Worker.`);
  } else say.skip("Worker not found. Skipping.");
  if (listDatabases(ctx).some((db) => db.name === DB_NAME)) {
    const result = wrangler(ctx, ["d1", "delete", DB_NAME, "--skip-confirmation"], { write: true });
    if (!result.ok) throw new Error(`Could not delete the database: ${failure(result)}`);
    if (!ctx.dryRun) say.ok(`Deleted the ${DB_NAME} database.`);
  } else say.skip("Database not found. Skipping.");
  const namespace = listNamespaces(ctx).find((ns) => ns.title === KV_TITLE);
  if (namespace) {
    const result = wrangler(ctx, ["kv", "namespace", "delete", "--namespace-id", namespace.id, "--skip-confirmation"], { write: true });
    if (!result.ok) throw new Error(`Could not delete the namespace: ${failure(result)}`);
    if (!ctx.dryRun) say.ok(`Deleted the ${KV_TITLE} namespace.`);
  } else say.skip("Namespace not found. Skipping.");
  saveOverlay(ctx, { databaseId: undefined, kvNamespaceId: undefined });
  if (await approve(ctx, "Keep the sign-in list and domain settings for the next setup?", true)) return;
  saveOverlay(ctx, { allowedEmails: undefined, domain: undefined, aliases: undefined, workersDev: undefined });
}
