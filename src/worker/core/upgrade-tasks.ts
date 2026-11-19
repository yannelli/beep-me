import { version } from "../../../package.json";
import { TELEGRAM_UPDATES, tg } from "../channels/telegram-api";
import { decryptJson } from "../lib/crypto";

interface WebhookInfo {
  url: string;
  allowed_updates?: string[];
}

let started: Promise<void> | null = null;

/** Runs once per isolate. Only the isolate that stores a new app_version runs the tasks. */
export function runUpgradeTasks(env: Env): Promise<void> {
  started ??= claimVersion(env)
    .then((claimed) => (claimed ? refreshTelegramWebhooks(env) : undefined))
    .catch((error: unknown) => console.error("Upgrade tasks failed", error instanceof Error ? error.message : error));
  return started;
}

async function claimVersion(env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    `INSERT INTO meta (key, value) VALUES ('app_version', ?1)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE meta.value <> excluded.value
     RETURNING value`,
  )
    .bind(version)
    .first();
  if (row) console.log(`Beep Me ${version}: running upgrade tasks.`);
  return row !== null;
}

/** Sets each Beep Me webhook again with the current update list. It keeps the URL, the secret, and pending updates. */
async function refreshTelegramWebhooks(env: Env): Promise<void> {
  const { results } = await env.DB.prepare("SELECT id, config_enc FROM channels WHERE kind = 'telegram'").all<{ id: string; config_enc: string }>();
  for (const row of results) {
    try {
      const config = await decryptJson<{ botToken: string; webhookSecret?: string }>(env.APP_SECRET, row.config_enc);
      if (!config.webhookSecret) continue;
      const info = await tg<WebhookInfo>(config.botToken, "getWebhookInfo");
      if (!info.url.includes(`/hooks/telegram/${row.id}`)) continue;
      if (TELEGRAM_UPDATES.every((type) => info.allowed_updates?.includes(type))) continue;
      await tg<boolean>(config.botToken, "setWebhook", { url: info.url, secret_token: config.webhookSecret, allowed_updates: TELEGRAM_UPDATES });
      console.log(`Telegram channel ${row.id}: webhook updates set to ${TELEGRAM_UPDATES.join(", ")}.`);
    } catch (error) {
      console.error(`Telegram channel ${row.id}: webhook refresh failed.`, error instanceof Error ? error.message : error);
    }
  }
}
