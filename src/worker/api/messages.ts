import { Hono } from "hono";
import { z } from "zod";
import { PRIORITIES } from "../../shared/priority";
import type { AppEnv } from "../auth/session";
import { notify } from "../core/notify";
import { getMessage, listMessages } from "../db/messages";
import { listTopics, setTopicMuted } from "../db/topics";
import { badRequest, notFound, readJson, runContext, zodFields } from "./util";

export const messagesApi = new Hono<AppEnv>();

messagesApi.get("/messages", async (c) => {
  const query = c.req.query();
  const page = await listMessages(c.env.DB, c.get("user").id, {
    before: query.before ? Number(query.before) : undefined,
    agentId: query.agent || undefined,
    status: query.status || undefined,
    priority: query.priority || undefined,
    topic: query.topic || undefined,
    limit: query.limit ? Number(query.limit) : undefined,
  });
  return c.json(page);
});

messagesApi.get("/messages/:id", async (c) => {
  const message = await getMessage(c.env.DB, c.get("user").id, c.req.param("id"));
  return message ? c.json(message) : notFound(c, "Message not found");
});

const testSchema = z.object({ priority: z.enum(PRIORITIES).default("medium"), topic: z.string().trim().max(64).optional() });

messagesApi.post("/messages/test", async (c) => {
  const user = c.get("user");
  const parsed = testSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, "Invalid test.", zodFields(parsed.error));
  const { priority, topic } = parsed.data;
  const result = await notify(runContext(c), user, { agent: null, name: "Beep Me", source: "test" }, {
    title: `Test: ${priority} priority`,
    message: `This test went through your ${priority} route${topic ? ` with the topic "${topic}"` : ""}. Check that it arrived where you expect.`,
    priority,
    topic: topic ?? null,
  });
  const message = await getMessage(c.env.DB, user.id, result.id);
  return message ? c.json(message) : notFound(c, "Message not found");
});

messagesApi.get("/topics", async (c) => c.json({ items: await listTopics(c.env.DB, c.get("user").id) }));

messagesApi.patch("/topics/:id", async (c) => {
  const muted = (await readJson(c)).muted;
  if (typeof muted !== "boolean") return badRequest(c, "Send { muted: true } or { muted: false }.");
  const topic = await setTopicMuted(c.env.DB, c.get("user").id, c.req.param("id"), muted);
  return topic ? c.json(topic) : notFound(c, "Topic not found");
});
