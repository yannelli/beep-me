import { approve, approveDestructive, confirmValue, exitIfMissing, need, saveOverlay, type Ctx } from "./context.ts";
import { existingDns, listCustomDomains, listZones, workersDevUrl, type CustomDomain, type Zone } from "./cloudflare.ts";
import { customDomains, type Overlay } from "./overlay.ts";
import { bold, dim, prompt, say } from "./ui.ts";
import { api, WORKER } from "./wrangler.ts";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function zoneFor(hostname: string, zones: Zone[]): Zone | undefined {
  return zones.filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`)).sort((a, b) => b.name.length - a.name.length)[0];
}

function checkHostname(hostname: string, zones: Zone[] | null): string | undefined {
  if (!HOSTNAME.test(hostname)) return `${hostname} is not a valid hostname. Use a name such as beep.example.com.`;
  if (zones && !zoneFor(hostname, zones)) return `${hostname} is not in a zone on this Cloudflare account.`;
  return undefined;
}

async function askHostname(ctx: Ctx, zones: Zone[] | null, workersDev: string | null): Promise<string | null> {
  const current = ctx.overlay.domain;
  const options = [
    { value: "", label: `Keep ${workersDev ?? "the workers.dev address"}`, hint: "free, no domain needed" },
    ...(current ? [{ value: current, label: current, hint: "current" }] : []),
    ...(zones ?? []).map((zone) => `beep.${zone.name}`).filter((name) => name !== current).map((name) => ({ value: name, label: name })),
    { value: "other", label: "Type a hostname" },
  ];
  const choice = await prompt.select("Where should Beep Me live?", options, current ?? "");
  if (choice !== "other") return choice || null;
  const suggestion = zones?.[0] ? `beep.${zones[0].name}` : "beep.example.com";
  return prompt.text("Hostname", { placeholder: suggestion, validate: (value) => checkHostname(value.toLowerCase(), zones) });
}

async function askAliases(ctx: Ctx, primary: string, zones: Zone[] | null): Promise<string[]> {
  const answer = await prompt.text("Aliases that redirect to it, comma-separated. Leave empty for none.", {
    initial: (ctx.overlay.aliases ?? []).join(", "),
    validate: (value) => splitHosts(value).map((host) => (host === primary ? `${host} is the primary hostname.` : checkHostname(host, zones))).find(Boolean),
  });
  return splitHosts(answer);
}

function splitHosts(value: string): string[] {
  return [...new Set(value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean))];
}

/** Stops when a hostname belongs to another Worker or has DNS records Wrangler would replace. */
async function checkConflicts(ctx: Ctx, hosts: string[], zones: Zone[] | null, attached: CustomDomain[]): Promise<void> {
  for (const host of hosts) {
    const owner = attached.find((domain) => domain.hostname === host);
    if (owner?.service === WORKER) continue;
    if (owner) throw new Error(`${host} already serves the Worker "${owner.service}". Remove it there first, or pick another hostname.`);
    const dns = await existingDns(ctx, host, zones ? zoneFor(host, zones) : undefined);
    if (dns !== "records") continue;
    const message = `${host} already has DNS records. Deploying replaces them with a record for Beep Me.`;
    if (ctx.interactive) {
      say.warn(message);
      if (!(await prompt.confirm(`Replace the DNS records for ${host} on deploy?`, false))) throw new Error(`Pick another hostname, or delete the DNS records for ${host} first.`);
    } else if (!confirmValue(ctx, "replace-dns") && !ctx.dryRun) {
      need(ctx, "--confirm replace-dns", message);
    }
  }
  exitIfMissing(ctx);
}

/** Detaches custom domains that the new config drops. Wrangler deploy does not detach them when no custom domain is left. */
async function detachRemoved(ctx: Ctx, next: string[], attached: CustomDomain[]): Promise<void> {
  if (next.length) return;
  const removed = attached.filter((domain) => domain.service === WORKER);
  if (!removed.length) return;
  const names = removed.map((domain) => domain.hostname).join(", ");
  if (!(await approveDestructive(ctx, `Detach ${names} from Beep Me now? Requests to them stop reaching the Worker.`, "detach"))) return;
  for (const domain of removed) {
    const response = await api(ctx, `/accounts/${ctx.accountId}/workers/domains/${domain.id}`, "DELETE");
    if (!response.ok && !ctx.dryRun) throw new Error(`Could not detach ${domain.hostname}: ${response.error ?? response.status}`);
  }
  say.ok(`Detached ${names}.`);
}

function headlessChoice(ctx: Ctx): Pick<Overlay, "domain" | "aliases" | "workersDev"> {
  const flag = ctx.flags.domain?.trim().toLowerCase();
  const domain = flag === undefined ? ctx.overlay.domain : flag === "none" || flag === "workers.dev" ? undefined : flag;
  const aliases = ctx.flags.alias ? splitHosts(ctx.flags.alias.join(",")) : domain ? ctx.overlay.aliases : undefined;
  const mode = ctx.flags["workers-dev"];
  if (mode !== undefined && mode !== "on" && mode !== "off") need(ctx, "--workers-dev on|off", `got "${mode}"`);
  const workersDev = mode === undefined ? (domain ? ctx.overlay.workersDev : true) : mode === "on";
  return { domain, aliases: aliases?.length ? aliases : undefined, workersDev };
}

/** Chooses the hostnames. Returns true when they changed. */
export async function configureDomain(ctx: Ctx): Promise<boolean> {
  const [zones, workersDev, attached] = await Promise.all([listZones(ctx), workersDevUrl(ctx), listCustomDomains(ctx)]);
  if (!zones) say.warn("Could not list your Cloudflare zones. Type the hostname yourself.");
  let next: Pick<Overlay, "domain" | "aliases" | "workersDev">;
  if (ctx.interactive) {
    const domain = (await askHostname(ctx, zones, workersDev)) ?? undefined;
    const aliases = domain ? await askAliases(ctx, domain, zones) : [];
    const workersDevOn = domain
      ? await prompt.confirm(`Keep ${workersDev ?? "the workers.dev address"} on? It redirects to ${domain}.`, ctx.overlay.workersDev ?? true)
      : true;
    next = { domain, aliases: aliases.length ? aliases : undefined, workersDev: workersDevOn };
  } else {
    next = headlessChoice(ctx);
    for (const host of customDomains(next)) {
      const problem = checkHostname(host, zones);
      if (problem) need(ctx, `--domain / --alias`, problem);
    }
    exitIfMissing(ctx);
  }
  const before = JSON.stringify(customDomains(ctx.overlay)) + String(ctx.overlay.workersDev ?? true);
  const after = JSON.stringify(customDomains(next)) + String(next.workersDev ?? true);
  if (before === after) {
    say.skip(next.domain ? `Domain found: ${next.domain}. Skipping.` : `Using ${workersDev ?? "the workers.dev address"}.`);
    return false;
  }
  await checkConflicts(ctx, customDomains(next), zones, attached);
  const summary = next.domain ? `${bold(next.domain)}${next.aliases?.length ? `, aliases ${next.aliases.join(", ")}` : ""}` : bold("workers.dev");
  if (!(await approve(ctx, `Serve Beep Me on ${summary}?`))) return false;
  await detachRemoved(ctx, customDomains(next), attached);
  saveOverlay(ctx, next);
  say.ok(`Domain set. ${dim("Wrangler creates the DNS record and certificate on the next deploy.")}`);
  return true;
}

export function domainChangeNote(origin: string): string {
  return [
    "When you change the address, also do these steps:",
    `1. Google: add ${bold(`${origin}/auth/google/callback`)} to the OAuth client's redirect URIs.`,
    "   https://console.cloud.google.com/auth/clients",
    `2. MCP clients: connect again with ${bold(`${origin}/mcp`)}. Sign-in tokens work only on the address that issued them.`,
    `   claude mcp remove beep-me && claude mcp add --transport http --scope user beep-me ${origin}/mcp`,
    "3. Telegram: open each Telegram channel in the dashboard and select Save changes. Beep Me moves the webhook.",
    `4. Scripts that call /v1/notify can keep the old address, but update them to ${origin}.`,
  ].join("\n");
}
