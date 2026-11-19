import { Hono } from "hono";
import { z } from "zod";
import { PRIORITIES } from "../../shared/priority";
import { revokeAgentAccess } from "../auth/consent";
import type { AppEnv } from "../auth/session";
import { createAgent, deleteAgent, getAgent, listAgents, newAgentToken, setAgentToken, toAgentDTO, updateAgent } from "../db/agents";
import { listChannels } from "../db/channels";
import { badRequest, notFound, readJson, zodFields } from "./util";

export const agentsApi = new Hono<AppEnv>();

const createSchema = z.object({
  name: z.string().trim().min(1, "Give the agent a name.").max(60),
  maxPriority: z.enum(PRIORITIES).default("high"),
  channelIds: z.array(z.string()).nullable().default(null),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  maxPriority: z.enum(PRIORITIES).optional(),
  channelIds: z.array(z.string()).nullable().optional(),
  smsPerHour: z.number().int().min(0).max(100).nullable().optional(),
  messagesPerHour: z.number().int().min(1).max(1000).nullable().optional(),
  mutedUntil: z.number().nullable().optional(),
});

async function ownedChannelIds(env: Env, userId: string, ids: string[] | null | undefined): Promise<string[] | null | undefined> {
  if (!ids) return ids;
  const owned = new Set((await listChannels(env, userId)).map((channel) => channel.id));
  return ids.filter((id) => owned.has(id));
}

agentsApi.get("/", async (c) => c.json({ items: await listAgents(c.env.DB, c.get("user").id) }));

agentsApi.post("/", async (c) => {
  const user = c.get("user");
  const parsed = createSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, "Check the highlighted fields.", zodFields(parsed.error));
  const token = newAgentToken();
  const agent = await createAgent(
    c.env.DB,
    { userId: user.id, name: parsed.data.name, kind: "token", maxPriority: parsed.data.maxPriority, channelIds: (await ownedChannelIds(c.env, user.id, parsed.data.channelIds)) ?? null },
    token,
  );
  return c.json({ agent: toAgentDTO(agent), token });
});

agentsApi.patch("/:id", async (c) => {
  const user = c.get("user");
  const parsed = updateSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, "Check the highlighted fields.", zodFields(parsed.error));
  const patch = { ...parsed.data, channelIds: await ownedChannelIds(c.env, user.id, parsed.data.channelIds) };
  const agent = await updateAgent(c.env.DB, user.id, c.req.param("id"), patch);
  return agent ? c.json(toAgentDTO(agent)) : notFound(c, "Agent not found");
});

agentsApi.post("/:id/revoke", async (c) => {
  const agent = await revokeAgentAccess(c.env, c.get("user").id, c.req.param("id"));
  return agent ? c.json(toAgentDTO(agent)) : notFound(c, "Agent not found");
});

agentsApi.post("/:id/rotate", async (c) => {
  const user = c.get("user");
  const agent = await getAgent(c.env.DB, c.req.param("id"), user.id);
  if (!agent) return notFound(c, "Agent not found");
  if (agent.kind !== "token" || agent.status !== "active") return badRequest(c, "Only active token agents have a token to rotate.");
  const token = newAgentToken();
  await setAgentToken(c.env.DB, agent.id, token);
  return c.json({ agent: toAgentDTO({ ...agent, tokenHint: token.slice(-4) }), token });
});

agentsApi.delete("/:id", async (c) => {
  const deleted = await deleteAgent(c.env.DB, c.get("user").id, c.req.param("id"));
  return deleted ? c.json({ ok: true }) : badRequest(c, "Revoke the agent before you delete it.");
});
