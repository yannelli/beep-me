import { resolveAny } from "node:dns/promises";
import { approve, exitIfMissing, need, saveOverlay, type Ctx } from "./context.ts";
import { bold, dim, prompt, say } from "./ui.ts";
import { api, DB_NAME, failure, KV_TITLE, parseJson, wrangler, WORKER } from "./wrangler.ts";

export interface Account {
  id: string;
  name: string;
}

export function whoami(ctx: Ctx): { email?: string; accounts: Account[] } | null {
  const result = wrangler(ctx, ["whoami", "--json"]);
  const parsed = parseJson<{ loggedIn?: boolean; email?: string; accounts?: Account[] }>(result.stdout);
  if (!result.ok || !parsed?.loggedIn) return null;
  return { email: parsed.email, accounts: (parsed.accounts ?? []).map(({ id, name }) => ({ id, name })) };
}

/** Signs in if needed and sets ctx.accountId. Only setup replaces a saved account, because the saved D1 and KV ids belong to it. */
export async function signIn(ctx: Ctx, options: { persist?: boolean } = {}): Promise<Account> {
  let me = whoami(ctx);
  if (!me) {
    if (!ctx.interactive) {
      need(ctx, "wrangler login", "or set CLOUDFLARE_API_TOKEN. Cloudflare is not signed in.");
      exitIfMissing(ctx);
    }
    if (!(await approve(ctx, "Open the Cloudflare sign-in page in your browser?"))) throw new Error("Sign in to Cloudflare to continue.");
    wrangler(ctx, ["login"], { inherit: true });
    me = whoami(ctx);
    if (!me) throw new Error("Cloudflare sign-in did not finish. Run bunx wrangler login, then try again.");
  }
  const wanted = ctx.flags["account-id"] ?? ctx.overlay.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  let account = me.accounts.find((entry) => entry.id === wanted);
  if (wanted && !account) throw new Error(`Account ${wanted} is not in this Cloudflare login. Run bunx wrangler whoami to list accounts.`);
  if (!account && me.accounts.length === 1) account = me.accounts[0];
  if (!account && ctx.interactive) {
    const id = await prompt.select("Which Cloudflare account?", me.accounts.map((entry) => ({ value: entry.id, label: entry.name, hint: entry.id })));
    account = me.accounts.find((entry) => entry.id === id);
  }
  if (!account) {
    need(ctx, "--account-id <id>", `this login has ${me.accounts.length} accounts: ${me.accounts.map((entry) => `${entry.id} (${entry.name})`).join(", ")}`);
    exitIfMissing(ctx);
    throw new Error("No account selected.");
  }
  ctx.accountId = account.id;
  if (!ctx.overlay.accountId || (options.persist && ctx.overlay.accountId !== account.id)) saveOverlay(ctx, { accountId: account.id });
  return account;
}

export function listDatabases(ctx: Ctx): { uuid: string; name: string }[] {
  const result = wrangler(ctx, ["d1", "list", "--json"]);
  const list = parseJson<{ uuid: string; name: string }[]>(result.stdout);
  if (!result.ok || !list) throw new Error(`Could not list D1 databases: ${failure(result)}`);
  return list;
}

export function listNamespaces(ctx: Ctx): { id: string; title: string }[] {
  const result = wrangler(ctx, ["kv", "namespace", "list"]);
  const list = parseJson<{ id: string; title: string }[]>(result.stdout);
  if (!result.ok || !list) throw new Error(`Could not list KV namespaces: ${failure(result)}`);
  return list;
}

export interface WorkerSecrets {
  deployed: boolean;
  names: Set<string>;
}

export function workerSecrets(ctx: Ctx): WorkerSecrets {
  const result = wrangler(ctx, ["secret", "list", "--name", WORKER, "--format", "json"]);
  const list = parseJson<{ name: string }[]>(result.stdout);
  if (result.ok && list) return { deployed: true, names: new Set(list.map((entry) => entry.name)) };
  if (/not found/i.test(failure(result))) return { deployed: false, names: new Set() };
  throw new Error(`Could not read Worker secrets: ${failure(result)}`);
}

const subdomains = new Map<string, string | null>();

export async function workersDevUrl(ctx: Ctx): Promise<string | null> {
  const account = ctx.accountId ?? "";
  if (!subdomains.has(account)) {
    const response = await api<{ subdomain?: string }>(ctx, `/accounts/${account}/workers/subdomain`);
    subdomains.set(account, response.result?.subdomain ? `https://${WORKER}.${response.result.subdomain}.workers.dev` : null);
  }
  return subdomains.get(account) ?? null;
}

export interface Zone {
  id: string;
  name: string;
}

export async function listZones(ctx: Ctx): Promise<Zone[] | null> {
  const response = await api<Zone[]>(ctx, `/zones?account.id=${ctx.accountId}&status=active&per_page=50`);
  return response.ok ? (response.result ?? []) : null;
}

export interface CustomDomain {
  id: string;
  hostname: string;
  service: string;
  zone_name: string;
}

export async function listCustomDomains(ctx: Ctx): Promise<CustomDomain[]> {
  const response = await api<CustomDomain[]>(ctx, `/accounts/${ctx.accountId}/workers/domains`);
  return response.result ?? [];
}

/** Uses the DNS API when the token can read DNS; the Wrangler login cannot, so it falls back to a public lookup. */
export async function existingDns(ctx: Ctx, hostname: string, zone: Zone | undefined): Promise<"none" | "records" | "unknown"> {
  if (zone) {
    const response = await api<unknown[]>(ctx, `/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`);
    if (response.ok) return response.result?.length ? "records" : "none";
  }
  try {
    return (await resolveAny(hostname)).length ? "records" : "none";
  } catch (error) {
    return (error as { code?: string }).code === "ENOTFOUND" || (error as { code?: string }).code === "ENODATA" ? "none" : "unknown";
  }
}

export async function ensureDatabase(ctx: Ctx): Promise<void> {
  const list = listDatabases(ctx);
  const saved = list.find((db) => db.uuid === ctx.overlay.databaseId);
  if (saved) return say.skip(`D1 database found: ${saved.name} ${dim(saved.uuid)}. Skipping.`);
  const existing = list.find((db) => db.name === DB_NAME);
  if (existing) {
    if (!(await approve(ctx, `Use the D1 database ${bold(DB_NAME)} that is in this account (${existing.uuid})?`))) throw new Error("Beep Me needs a D1 database.");
    saveOverlay(ctx, { databaseId: existing.uuid });
    return say.ok(`Using D1 database ${DB_NAME}.`);
  }
  if (!(await approve(ctx, `Create a D1 database named ${bold(DB_NAME)}?`))) throw new Error("Beep Me needs a D1 database.");
  const created = wrangler(ctx, ["d1", "create", DB_NAME], { write: true });
  if (!created.ok) throw new Error(`Could not create the D1 database: ${failure(created)}`);
  if (ctx.dryRun) return;
  const id = listDatabases(ctx).find((db) => db.name === DB_NAME)?.uuid;
  if (!id) throw new Error("Wrangler created the database, but the list does not show it yet. Run setup again.");
  saveOverlay(ctx, { databaseId: id });
  say.ok(`Created D1 database ${DB_NAME} ${dim(id)}.`);
}

export async function ensureNamespace(ctx: Ctx): Promise<void> {
  const list = listNamespaces(ctx);
  const saved = list.find((ns) => ns.id === ctx.overlay.kvNamespaceId);
  if (saved) return say.skip(`KV namespace found: ${saved.title} ${dim(saved.id)}. Skipping.`);
  const existing = list.find((ns) => ns.title === KV_TITLE);
  if (existing) {
    if (!(await approve(ctx, `Use the KV namespace ${bold(KV_TITLE)} that is in this account (${existing.id})?`))) throw new Error("Beep Me needs a KV namespace.");
    saveOverlay(ctx, { kvNamespaceId: existing.id });
    return say.ok(`Using KV namespace ${KV_TITLE}.`);
  }
  if (!(await approve(ctx, `Create a KV namespace named ${bold(KV_TITLE)} for sign-in tokens?`))) throw new Error("Beep Me needs a KV namespace.");
  const created = wrangler(ctx, ["kv", "namespace", "create", KV_TITLE], { write: true });
  if (!created.ok) throw new Error(`Could not create the KV namespace: ${failure(created)}`);
  if (ctx.dryRun) return;
  const id = listNamespaces(ctx).find((ns) => ns.title === KV_TITLE)?.id;
  if (!id) throw new Error("Wrangler created the namespace, but the list does not show it yet. Run setup again.");
  saveOverlay(ctx, { kvNamespaceId: id });
  say.ok(`Created KV namespace ${KV_TITLE} ${dim(id)}.`);
}
