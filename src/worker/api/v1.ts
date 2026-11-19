import { Hono, type Context } from "hono";
import type { AppEnv } from "../auth/session";
import { notify, notifyInputSchema } from "../core/notify";
import { fetchReplies, interactionMedia } from "../core/replies";
import { findAgentByToken, touchAgent, type Agent } from "../db/agents";
import { getInteraction } from "../db/interactions";
import { getUser } from "../db/users";
import { getRepliesInput } from "../mcp/replies";
import { runContext, zodFields } from "./util";

export const v1Routes = new Hono<AppEnv>();

async function tokenAgent(c: Context<AppEnv>): Promise<Agent | null> {
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const agent = token ? await findAgentByToken(c.env.DB, token) : null;
  return agent && agent.status === "active" ? agent : null;
}

function unauthorized(c: Context<AppEnv>) {
  c.header("www-authenticate", 'Bearer error="invalid_token"');
  return c.json({ error: "Missing or revoked agent token. Create one in Beep Me under Agents." }, 401);
}

/** GET /v1/replies?message_id&since&wait_seconds&include_read&limit. Same result as the get_replies MCP tool. */
v1Routes.get("/replies", async (c) => {
  const agent = await tokenAgent(c);
  if (!agent) return unauthorized(c);
  const query = c.req.query();
  const parsed = getRepliesInput.safeParse({
    ...query,
    wait_seconds: query.wait_seconds ? Number(query.wait_seconds) : undefined,
    include_read: query.include_read ? query.include_read === "true" : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  });
  if (!parsed.success) return c.json({ error: "Invalid query", fields: zodFields(parsed.error) }, 400);
  const batch = await fetchReplies(c.env, c.get("origin"), agent.id, {
    messageId: parsed.data.message_id,
    since: parsed.data.since ? Date.parse(parsed.data.since) : undefined,
    waitSeconds: parsed.data.wait_seconds,
    includeRead: parsed.data.include_read,
    limit: parsed.data.limit,
  });
  return c.json({ replies: batch.replies, waited_seconds: batch.waitedSeconds });
});

/** GET /v1/media/:interaction/:index streams a file the user sent back. Only the agent that owns the message can read it. */
v1Routes.get("/media/:interaction/:index", async (c) => {
  const agent = await tokenAgent(c);
  if (!agent) return unauthorized(c);
  const row = await getInteraction(c.env.DB, c.req.param("interaction"));
  if (!row || row.agent_id !== agent.id) return c.json({ error: "Not found" }, 404);
  return interactionMedia(c.env, row, Number(c.req.param("index")));
});

/** POST /v1/notify with a JSON body, or a plain-text body plus X-Title, X-Priority, X-Topic and X-Url headers (curl -d "Build done"). */
v1Routes.post("/notify", async (c) => {
  const agent = await tokenAgent(c);
  if (!agent) return unauthorized(c);
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
