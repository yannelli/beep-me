import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readOverlay, writeOverlay, type Overlay } from "./overlay.ts";

// Runs with Node alone: scripts/upgrade.sh copies this file and overlay.ts out of the release before any install.

export const BACKUP_DIR = ".beep-me/before-upgrade";
const LOCKFILES = ["package-lock.json", "bun.lock"];

export interface LegacyPlan {
  /** Values that wrangler.jsonc holds and the overlay does not. */
  moved: Partial<Overlay>;
  /** Files to copy into BACKUP_DIR, then restore or move away. */
  restore: string[];
  moveAway: string[];
  /** Edits in wrangler.jsonc that the overlay cannot hold. The update stops when this is not empty. */
  blockers: string[];
}

type Json = Record<string, unknown>;

function gitText(root: string, args: string[]): string | null {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function stringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === "\\") index++;
    else if (text[index] === '"') return index + 1;
  }
  return text.length;
}

/** JSON with comments and trailing commas, as Wrangler reads it. */
export function parseJsonc(text: string): Json {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      const end = stringEnd(text, index);
      out += text.slice(index, end);
      index = end;
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index++;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end < 0 ? text.length : end + 2;
    } else {
      if (char === "}" || char === "]") out = out.replace(/,\s*$/, "");
      out += char;
      index++;
    }
  }
  return JSON.parse(out) as Json;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, sorted(entry)]));
  return value;
}

function binding(config: Json, list: string, name: string): Json | undefined {
  const entries = Array.isArray(config[list]) ? (config[list] as Json[]) : [];
  return entries.find((entry) => entry.binding === name);
}

/** Removes the values the overlay holds, so what is left must match the release. */
function strip(config: Json): Json {
  const copy = structuredClone(config);
  delete binding(copy, "d1_databases", "DB")?.database_id;
  delete binding(copy, "kv_namespaces", "OAUTH_KV")?.id;
  const vars = (copy.vars ?? {}) as Json;
  delete vars.ALLOWED_EMAILS;
  delete vars.PUBLIC_URL;
  for (const key of ["account_id", "routes", "workers_dev"]) delete copy[key];
  return copy;
}

function hostOf(value: unknown): string | undefined {
  try {
    return typeof value === "string" && value ? new URL(value).hostname : undefined;
  } catch {
    return undefined;
  }
}

function valuesIn(config: Json, blockers: string[]): Partial<Overlay> {
  const found: Partial<Overlay> = {};
  const databaseId = binding(config, "d1_databases", "DB")?.database_id;
  const kvId = binding(config, "kv_namespaces", "OAUTH_KV")?.id;
  const vars = (config.vars ?? {}) as Json;
  if (typeof databaseId === "string" && databaseId) found.databaseId = databaseId;
  if (typeof kvId === "string" && kvId) found.kvNamespaceId = kvId;
  if (typeof vars.ALLOWED_EMAILS === "string" && vars.ALLOWED_EMAILS) found.allowedEmails = vars.ALLOWED_EMAILS;
  if (typeof config.account_id === "string" && config.account_id) found.accountId = config.account_id;
  if (typeof config.workers_dev === "boolean") found.workersDev = config.workers_dev;
  const hosts: string[] = [];
  for (const route of Array.isArray(config.routes) ? (config.routes as unknown[]) : []) {
    const entry = route as Json;
    if (entry && entry.custom_domain === true && typeof entry.pattern === "string") hosts.push(entry.pattern);
    else blockers.push(`routes: ${JSON.stringify(route)} is a zone route. bun run cli domain sets custom domains only.`);
  }
  const primary = hostOf(vars.PUBLIC_URL) ?? hosts[0];
  if (primary) {
    found.domain = primary;
    const aliases = hosts.filter((host) => host !== primary);
    if (aliases.length) found.aliases = aliases;
  }
  return found;
}

export function planLegacy(root: string): LegacyPlan {
  const plan: LegacyPlan = { moved: {}, restore: [], moveAway: [], blockers: [] };
  const committed = gitText(root, ["show", "HEAD:wrangler.jsonc"]);
  const working = readFileSync(join(root, "wrangler.jsonc"), "utf8");
  if (committed !== null && committed !== working) {
    const before = parseJsonc(committed);
    const after = parseJsonc(working);
    const left = strip(after);
    const base = strip(before);
    for (const key of new Set([...Object.keys(left), ...Object.keys(base)])) {
      if (JSON.stringify(sorted(left[key])) !== JSON.stringify(sorted(base[key]))) plan.blockers.push(`wrangler.jsonc: "${key}" differs from the committed file.`);
    }
    const overlay = readOverlay(root);
    for (const [key, value] of Object.entries(valuesIn(after, plan.blockers))) {
      if (overlay[key as keyof Overlay] === undefined) Object.assign(plan.moved, { [key]: value });
    }
    plan.restore.push("wrangler.jsonc");
  }
  for (const file of LOCKFILES) {
    if (!existsSync(join(root, file))) continue;
    const tracked = gitText(root, ["show", `HEAD:${file}`]);
    if (tracked === null) plan.moveAway.push(file);
    else if (tracked !== readFileSync(join(root, file), "utf8")) plan.restore.push(file);
  }
  return plan;
}

/** Writes the overlay first and reads it back, then backs up each file before it changes. */
export function applyLegacy(root: string, plan: LegacyPlan): void {
  if (plan.blockers.length) throw new Error(`wrangler.jsonc has edits that the update cannot move:\n${plan.blockers.join("\n")}`);
  if (Object.keys(plan.moved).length) {
    writeOverlay(root, { ...plan.moved, ...readOverlay(root) });
    const saved = readOverlay(root);
    for (const key of Object.keys(plan.moved)) {
      if (saved[key as keyof Overlay] === undefined) throw new Error(`Could not save ${key} in .beep-me/deploy.json. wrangler.jsonc is unchanged.`);
    }
  }
  const backup = join(root, BACKUP_DIR);
  mkdirSync(backup, { recursive: true });
  for (const file of plan.restore) {
    writeFileSync(join(backup, file), readFileSync(join(root, file)));
    writeFileSync(join(root, file), gitText(root, ["show", `HEAD:${file}`]) ?? "");
  }
  for (const file of plan.moveAway) renameSync(join(root, file), join(backup, file));
}

export function describeLegacy(plan: LegacyPlan): string[] {
  const lines = Object.entries(plan.moved).map(([key, value]) => `Move ${key} = ${JSON.stringify(value)} from wrangler.jsonc to .beep-me/deploy.json`);
  for (const file of plan.restore) lines.push(`Copy ${file} to ${BACKUP_DIR}/, then restore the committed ${file}`);
  for (const file of plan.moveAway) lines.push(`Move the untracked ${file} to ${BACKUP_DIR}/`);
  return lines;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ?? process.cwd();
  const plan = planLegacy(root);
  if (process.argv.includes("--dry-run")) {
    for (const line of [...describeLegacy(plan), ...plan.blockers]) console.log(`  ${line}`);
    process.exit(plan.blockers.length ? 3 : 0);
  }
  try {
    applyLegacy(root, plan);
    if (plan.restore.length || plan.moveAway.length) console.log(`Saved deployment values in .beep-me/deploy.json. Copies of the old files are in ${BACKUP_DIR}/.`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(3);
  }
}
