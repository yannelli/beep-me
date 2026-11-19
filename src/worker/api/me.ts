import { Hono, type Context } from "hono";
import type { MeResponse, SessionResponse } from "../../shared/api";
import { settingsPatchSchema, type UserSettings } from "../../shared/settings";
import { googleConfigured, googleRedirectUri } from "../auth/google";
import { clearSessionCookie, isLocalHost, sessionUser, type AppEnv } from "../auth/session";
import { effectiveRoutes } from "../core/defaults";
import { isQuietNow } from "../core/quiet";
import { listChannels } from "../db/channels";
import { deleteUser, saveSettings, toUserDTO, type User } from "../db/users";
import { badRequest, readJson, zodFields } from "./util";

export const publicApi = new Hono<AppEnv>();
export const meApi = new Hono<AppEnv>();

publicApi.get("/session", async (c) => {
  const user = await sessionUser(c.req.raw, c.env);
  const body: SessionResponse = {
    user: user ? toUserDTO(user) : null,
    setup: {
      googleConfigured: googleConfigured(c.env),
      devLogin: c.env.DEV_LOGIN === "true" && isLocalHost(c.req.raw),
      googleRedirectUri: googleRedirectUri(c.get("origin")),
    },
  };
  return c.json(body);
});

export async function meResponse(c: Context<AppEnv>, user: User): Promise<MeResponse> {
  const origin = c.get("origin");
  const channels = await listChannels(c.env, user.id);
  const counts = await c.env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM agents WHERE user_id = ?1 AND status = 'active') AS agents,
            (SELECT COUNT(*) FROM messages WHERE user_id = ?1) AS messages`,
  )
    .bind(user.id)
    .first<{ agents: number; messages: number }>();
  const settings: UserSettings = { ...user.settings, routes: effectiveRoutes(user.settings, channels) };
  return {
    user: toUserDTO(user),
    settings,
    mcpUrl: `${origin}/mcp`,
    notifyUrl: `${origin}/v1/notify`,
    appUrl: origin,
    counts: { channels: channels.length, agents: counts?.agents ?? 0, messages: counts?.messages ?? 0 },
    quietNow: isQuietNow(user.settings.quietHours, user.settings.timezone),
    gmailOAuthAvailable: googleConfigured(c.env),
  };
}

meApi.get("/me", async (c) => c.json(await meResponse(c, c.get("user"))));

meApi.patch("/settings", async (c) => {
  const user = c.get("user");
  const parsed = settingsPatchSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, "Some settings are not valid.", zodFields(parsed.error));
  const patch = parsed.data;
  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
    } catch {
      return badRequest(c, "Unknown time zone.", { timezone: "Pick a time zone from the list." });
    }
  }
  const owned = new Set((await listChannels(c.env, user.id)).map((channel) => channel.id));
  const keepOwned = <T extends { channelId: string }>(list: T[]) => list.filter((d) => owned.has(d.channelId));
  const next: UserSettings = { ...user.settings, ...patch };
  if (patch.routes) {
    next.routes = { urgent: keepOwned(patch.routes.urgent), high: keepOwned(patch.routes.high), medium: keepOwned(patch.routes.medium), low: keepOwned(patch.routes.low) };
    next.routesCustomized = patch.routesCustomized ?? true;
  }
  if (patch.rules) {
    next.rules = patch.rules.map((rule) =>
      rule.action.type === "route" ? { ...rule, action: { ...rule.action, destinations: keepOwned(rule.action.destinations) } } : rule,
    );
  }
  await saveSettings(c.env.DB, user.id, next);
  return c.json(await meResponse(c, { ...user, settings: next }));
});

meApi.post("/pause", async (c) => {
  const user = c.get("user");
  const minutes = (await readJson(c)).minutes;
  if (minutes !== null && (typeof minutes !== "number" || minutes <= 0 || minutes > 7 * 1440)) {
    return badRequest(c, "Pause for 1 minute to 7 days, or send null to resume.");
  }
  const settings: UserSettings = { ...user.settings, pausedUntil: minutes === null ? null : Date.now() + minutes * 60_000 };
  await saveSettings(c.env.DB, user.id, settings);
  return c.json(await meResponse(c, { ...user, settings }));
});

meApi.delete("/account", async (c) => {
  const user = c.get("user");
  let cursor: string | undefined;
  do {
    const page = await c.env.OAUTH_PROVIDER.listUserGrants(user.id, { cursor });
    await Promise.all(page.items.map((grant) => c.env.OAUTH_PROVIDER.revokeGrant(grant.id, user.id)));
    cursor = page.cursor;
  } while (cursor);
  await deleteUser(c.env.DB, user.id);
  c.header("set-cookie", clearSessionCookie(c.get("origin")));
  return c.json({ ok: true });
});
