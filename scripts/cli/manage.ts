import { approve, approveDestructive, exitIfMissing, requireYes, UsageError, type Ctx } from "./context.ts";
import { listCustomDomains, workersDevUrl, workerSecrets, type Account } from "./cloudflare.ts";
import { ago, bold, dim, red, say, table } from "./ui.ts";
import { query, sql } from "./wrangler.ts";

const DAY_MS = 86_400_000;
const MAX_MINUTES = 7 * 1440;

function output(ctx: Ctx, data: unknown, text: () => void): void {
  if (ctx.json) process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
  else text();
}

function rowsOrThrow<T>(ctx: Ctx, statement: string): T[] {
  const result = query<T>(ctx, statement);
  if (!result.ok) throw new Error(explainDbError(result.error ?? ""));
  return result.rows;
}

function explainDbError(error: string): string {
  if (/no such table/i.test(error)) return "The database has no tables yet. Open the dashboard once, and the Worker creates them.";
  if (/Couldn't find a D1 DB/i.test(error)) return "The beep-me D1 database does not exist in this account. Run bun run setup.";
  return error;
}

function minutesArg(value: string | undefined, allowZero: boolean): number {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < (allowZero ? 0 : 1) || minutes > MAX_MINUTES) {
    throw new UsageError(`Give minutes as a whole number from ${allowZero ? 0 : 1} to ${MAX_MINUTES}.`);
  }
  return minutes;
}

function idArg(value: string | undefined): string {
  if (!value || !/^[\w-]+$/.test(value)) throw new UsageError("Give an agent ID, for example agt_abc123. Run bun run cli agents list to see them.");
  return value;
}

interface Counts {
  users: number;
  agents: number;
  revoked: number;
  channels: number;
  messages24h: number;
  pausedUntil: number | null;
}

export async function status(ctx: Ctx, account: Account): Promise<void> {
  const secrets = workerSecrets(ctx);
  const [workersDev, domains] = await Promise.all([workersDevUrl(ctx), listCustomDomains(ctx)]);
  const custom = domains.filter((domain) => domain.service === "beep-me").map((domain) => domain.hostname);
  const since = Date.now() - DAY_MS;
  const counts = query<Counts>(
    ctx,
    `SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM agents WHERE status = 'active') AS agents, ` +
      `(SELECT COUNT(*) FROM agents WHERE status = 'revoked') AS revoked, (SELECT COUNT(*) FROM channels) AS channels, ` +
      `(SELECT COUNT(*) FROM messages WHERE created_at > ${since}) AS messages24h, ` +
      `(SELECT MAX(json_extract(settings, '$.pausedUntil')) FROM users) AS pausedUntil`,
  );
  const data = {
    account,
    deployed: secrets.deployed,
    urls: [...custom.map((host) => `https://${host}`), ...(ctx.overlay.workersDev !== false && workersDev ? [workersDev] : [])],
    secrets: [...secrets.names].sort(),
    google: secrets.names.has("GOOGLE_CLIENT_ID") && secrets.names.has("GOOGLE_CLIENT_SECRET"),
    database: counts.ok ? counts.rows[0] : { error: explainDbError(counts.error ?? "") },
  };
  output(ctx, data, () => {
    const db = counts.ok ? counts.rows[0] : null;
    const paused = db?.pausedUntil && db.pausedUntil > Date.now() ? `paused until ${new Date(db.pausedUntil).toLocaleString()}` : "delivering";
    const lines = [
      `Account    ${account.name} ${dim(account.id)}`,
      `Worker     ${data.deployed ? "deployed" : red("not deployed. Run bun run setup.")}`,
      `Addresses  ${data.urls.join(", ") || "none"}`,
      `Secrets    ${data.secrets.join(", ") || "none"}`,
      `Google     ${data.google ? "set" : red("missing. Run bun run cli google.")}`,
      db
        ? `Data       ${db.users} users, ${db.agents} active agents (${db.revoked} revoked), ${db.channels} channels, ${db.messages24h} messages in 24h, ${paused}`
        : `Data       ${red(explainDbError(counts.error ?? ""))}`,
    ];
    say.block("Beep Me status", lines.join("\n"));
  });
}

export function agentsList(ctx: Ctx): void {
  const since = Date.now() - DAY_MS;
  const rows = rowsOrThrow<Record<string, number | string | null>>(
    ctx,
    `SELECT a.id, a.name, a.kind, a.status, a.max_priority, a.muted_until, a.last_seen_at, ` +
      `(SELECT COUNT(*) FROM messages m WHERE m.agent_id = a.id AND m.created_at > ${since}) AS sent_24h ` +
      `FROM agents a ORDER BY a.status = 'revoked', COALESCE(a.last_seen_at, a.created_at) DESC`,
  );
  output(ctx, rows, () => {
    const view = rows.map((row) => ({
      ...row,
      muted: Number(row.muted_until) > Date.now() ? `until ${new Date(Number(row.muted_until)).toLocaleTimeString()}` : "",
      seen: ago(row.last_seen_at as number | null),
    }));
    say.block("Agents", table(view, ["id", "name", "kind", "status", "max_priority", "muted", "seen", "sent_24h"]));
  });
}

function findAgent(ctx: Ctx, id: string): { id: string; name: string; status: string } {
  const agent = rowsOrThrow<{ id: string; name: string; status: string }>(ctx, `SELECT id, name, status FROM agents WHERE id = ${sql(id)}`)[0];
  if (!agent) throw new Error(`No agent with ID ${id}. Run bun run cli agents list.`);
  return agent;
}

/** Same UPDATE as revokeAgent in src/worker/db/agents.ts. Every MCP and REST request checks it in D1. */
export async function agentsRevoke(ctx: Ctx, idValue: string | undefined): Promise<void> {
  const agent = findAgent(ctx, idArg(idValue));
  if (agent.status === "revoked") return say.skip(`${agent.name} is already revoked.`);
  const message = `Revoke ${agent.name}? Its next request fails, and it cannot get access again.`;
  if (!(await approveDestructive(ctx, message, agent.id))) return say.skip("Canceled.");
  const result = query(ctx, `UPDATE agents SET status = 'revoked', revoked_at = ${Date.now()}, token_hash = NULL WHERE id = ${sql(agent.id)}`, { write: true });
  if (!result.ok) throw new Error(result.error);
  if (!ctx.dryRun) say.ok(`Revoked ${agent.name}.`);
}

export async function agentsMute(ctx: Ctx, idValue: string | undefined, minutesValue: string | undefined): Promise<void> {
  const minutes = minutesArg(minutesValue, true);
  const agent = findAgent(ctx, idArg(idValue));
  requireYes(ctx);
  exitIfMissing(ctx);
  const until = minutes ? Date.now() + minutes * 60_000 : null;
  if (!(await approve(ctx, minutes ? `Mute ${agent.name} for ${minutes} minutes?` : `Unmute ${agent.name}?`))) return;
  const result = query(ctx, `UPDATE agents SET muted_until = ${sql(until)} WHERE id = ${sql(agent.id)}`, { write: true });
  if (!result.ok) throw new Error(result.error);
  if (!ctx.dryRun) say.ok(minutes ? `Muted ${agent.name} until ${new Date(until ?? 0).toLocaleString()}.` : `Unmuted ${agent.name}.`);
}

export function channelsList(ctx: Ctx): void {
  const rows = rowsOrThrow<Record<string, number | string | null>>(
    ctx,
    "SELECT id, kind, name, enabled, status, last_used_at, last_error FROM channels ORDER BY created_at",
  );
  output(ctx, rows, () => {
    const view = rows.map((row) => ({ ...row, enabled: row.enabled ? "on" : "off", used: ago(row.last_used_at as number | null), error: row.last_error ?? "" }));
    say.block("Channels", table(view, ["id", "kind", "name", "enabled", "status", "used", "error"]));
  });
}

export function messagesList(ctx: Ctx): void {
  const limit = ctx.flags.limit === undefined ? 20 : Number(ctx.flags.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new UsageError("Give --limit as a whole number from 1 to 500.");
  const rows = rowsOrThrow<Record<string, number | string | null>>(
    ctx,
    `SELECT id, created_at, agent_name, priority, status, topic_key, COALESCE(title, substr(body, 1, 60)) AS summary FROM messages ORDER BY created_at DESC LIMIT ${limit}`,
  );
  output(ctx, rows, () => {
    const view = rows.map((row) => ({ ...row, sent: ago(row.created_at as number), topic: row.topic_key ?? "" }));
    say.block(`Latest ${rows.length} messages`, table(view, ["sent", "agent_name", "priority", "status", "topic", "summary"]));
  });
}

/** Sets pausedUntil for every user with json_set, so the other settings stay as they are. */
export async function pause(ctx: Ctx, minutesValue: string | undefined): Promise<void> {
  const minutes = minutesArg(minutesValue, false);
  requireYes(ctx);
  exitIfMissing(ctx);
  const until = Date.now() + minutes * 60_000;
  if (!(await approve(ctx, `Pause all delivery for ${minutes} minutes?`))) return;
  const result = query(ctx, `UPDATE users SET settings = json_set(settings, '$.pausedUntil', ${until}), updated_at = ${Date.now()}`, { write: true });
  if (!result.ok) throw new Error(explainDbError(result.error ?? ""));
  if (!ctx.dryRun) say.ok(`Paused until ${bold(new Date(until).toLocaleString())}. Run bun run cli resume to stop the pause.`);
}

export async function resume(ctx: Ctx): Promise<void> {
  requireYes(ctx);
  exitIfMissing(ctx);
  if (!(await approve(ctx, "Resume delivery now?"))) return;
  const result = query(ctx, `UPDATE users SET settings = json_set(settings, '$.pausedUntil', NULL), updated_at = ${Date.now()}`, { write: true });
  if (!result.ok) throw new Error(explainDbError(result.error ?? ""));
  if (!ctx.dryRun) say.ok("Delivery resumed.");
}
