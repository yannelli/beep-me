import { Hono } from "hono";
import { z } from "zod";
import { PRIORITIES } from "../../shared/priority";
import type { AppEnv } from "../auth/session";
import { notify } from "../core/notify";
import { recordInteraction } from "../db/interactions";
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

const answerSchema = z
  .object({ option: z.number().int().min(0).optional(), text: z.string().trim().min(1).max(4000).optional() })
  .refine((value) => value.option !== undefined || value.text !== undefined, "Pick an option or write an answer.");

/** Answer from the dashboard, for messages on channels that cannot carry a reply (Slack, Discord, Pushover). */
messagesApi.post("/messages/:id/answer", async (c) => {
  const user = c.get("user");
  const parsed = answerSchema.safeParse(await readJson(c));
  if (!parsed.success) return badRequest(c, "Pick an option or write an answer.", zodFields(parsed.error));
  const message = await getMessage(c.env.DB, user.id, c.req.param("id"));
  if (!message) return notFound(c, "Message not found");
  const { option, text } = parsed.data;
  if (option !== undefined && option >= message.options.length) return badRequest(c, "That option is not on this message.");
  const delivery = message.deliveries[0];
  if (!delivery) return badRequest(c, "Beep Me did not deliver this message, so there is nothing to answer.");
  await recordInteraction(c.env.DB, {
    userId: user.id,
    channelId: delivery.channelId,
    channelKind: delivery.channelKind,
    messageId: message.id,
    kind: option !== undefined ? "choice" : "reply",
    text: text ?? null,
    optionIndex: option ?? null,
    media: [],
    sender: "Dashboard",
    providerRef: null,
  });
  const updated = await getMessage(c.env.DB, user.id, message.id);
  return updated ? c.json(updated) : notFound(c, "Message not found");
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
