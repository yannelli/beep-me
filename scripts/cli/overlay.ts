import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const OVERLAY_FILE = ".beep-me/deploy.json";

/** Deployment values kept out of the committed wrangler.jsonc. */
export interface Overlay {
  accountId?: string;
  databaseId?: string;
  kvNamespaceId?: string;
  allowedEmails?: string;
  /** Primary hostname, for example beep.example.com. Sets PUBLIC_URL. */
  domain?: string;
  /** Extra hostnames that redirect to the primary hostname. */
  aliases?: string[];
  workersDev?: boolean;
}

interface OverlayTarget {
  account_id?: string;
  d1_databases: { binding: string; database_id?: string }[];
  kv_namespaces: { binding: string; id?: string }[];
  vars: Record<string, unknown>;
  routes?: unknown[];
  workers_dev?: boolean;
}

export function overlayPath(root: string): string {
  return join(root, OVERLAY_FILE);
}

export function readOverlay(root: string): Overlay {
  const path = overlayPath(root);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Overlay;
  } catch (error) {
    throw new Error(`${OVERLAY_FILE} is not valid JSON: ${(error as Error).message}`);
  }
}

export function writeOverlay(root: string, overlay: Overlay): void {
  const path = overlayPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(overlay, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function publicUrl(overlay: Overlay): string | undefined {
  return overlay.domain ? `https://${overlay.domain}` : undefined;
}

export function customDomains(overlay: Overlay): string[] {
  return overlay.domain ? [overlay.domain, ...(overlay.aliases ?? [])] : [];
}

/** Mutates the Worker config in place. The Vite plugin merges returned objects with defu, which appends arrays. */
export function applyOverlay(config: OverlayTarget, overlay: Overlay): void {
  if (overlay.accountId) config.account_id = overlay.accountId;
  const db = config.d1_databases.find((entry) => entry.binding === "DB");
  if (db && overlay.databaseId) db.database_id = overlay.databaseId;
  const kv = config.kv_namespaces.find((entry) => entry.binding === "OAUTH_KV");
  if (kv && overlay.kvNamespaceId) kv.id = overlay.kvNamespaceId;
  if (overlay.allowedEmails !== undefined) config.vars.ALLOWED_EMAILS = overlay.allowedEmails;
  const url = publicUrl(overlay);
  if (url) config.vars.PUBLIC_URL = url;
  const domains = customDomains(overlay);
  if (domains.length) config.routes = domains.map((pattern) => ({ pattern, custom_domain: true }));
  if (overlay.workersDev !== undefined) config.workers_dev = overlay.workersDev;
}
