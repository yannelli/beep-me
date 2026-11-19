import { Hono } from "hono";
import type { AppEnv } from "../auth/session";
import { notify, notifyInputSchema } from "../core/notify";
import { findAgentByToken, touchAgent } from "../db/agents";
import { getUser } from "../db/users";
import { runContext, zodFields } from "./util";

export const v1Routes = new Hono<AppEnv>();

/** POST /v1/notify with a JSON body, or a plain-text body plus X-Title, X-Priority, X-Topic and X-Url headers (curl -d "Build done"). */
v1Routes.post("/notify", async (c) => {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const agent = token ? await findAgentByToken(c.env.DB, token) : null;
  if (!agent || agent.status !== "active") {
    c.header("www-authenticate", 'Bearer error="invalid_token"');
    return c.json({ error: "Missing or revoked agent token. Create one in Beep Me under Agents." }, 401);
  }
  const user = await getUser(c.env.DB, agent.userId);
  if (!user) return c.json({ error: "Unknown user" }, 401);
  const contentType = c.req.header("content-type") ?? "";
  let raw: Record<string, unknown>;
  if (contentType.includes("application/json")) {
    raw = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  } else {
    const header = (name: string) => c.req.header(name) ?? c.req.query(name.replace(/^x-/, "")) ?? undefined;
    raw = { message: (await c.req.text()).trim(), title: header("x-title"), priority: header("x-priority"), topic: header("x-topic"), url: header("x-url") };
  }
  const parsed = notifyInputSchema.safeParse(raw);
  if (!parsed.success) return c.json({ error: "Invalid notification", fields: zodFields(parsed.error) }, 400);
  c.executionCtx.waitUntil(touchAgent(c.env.DB, agent.id, c.req.header("user-agent") ?? null));
  const result = await notify(runContext(c), user, { agent, name: agent.name, source: "api" }, parsed.data);
  return c.json(result);
});
