import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { MessageDTO } from "../../shared/api";
import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import { CHANNEL_KINDS, type ChannelKind } from "../../shared/channels";
import { PRIORITIES } from "../../shared/priority";
import { FALLBACK_TRIGGERS } from "../../shared/settings";
import { effectiveRoutes } from "../core/defaults";
import { watchUrl } from "../core/notify";
import { channelTargets, listChannels, type StoredChannel } from "../db/channels";
import { cancelFallbacks } from "../db/fallbacks";
import { getMessage } from "../db/messages";
import type { McpSession } from "./server";

function answersOn(channel: StoredChannel): string {
  const answers: Partial<Record<ChannelKind, string>> = {
    telegram: "Reply in the chat, tap option buttons, react, or send files.",
    twilio: "Reply by text message. A number picks an option.",
    telnyx: "Reply by text message. A number picks an option.",
    ntfy: "Tap option buttons.",
  };
  if (channel.kind === "resend" && channel.config.webhookSecret) return "Reply to the email.";
  return answers[channel.kind] ?? "Answer in the Beep Me dashboard. The message links to it.";
}

const channelSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(CHANNEL_KINDS),
  ready: z.boolean(),
  topic_threads: z.boolean(),
  text_message: z.boolean(),
  answers: z.string(),
  routes: z.array(z.enum(PRIORITIES)),
});

const statusOutput = z.object({
  id: z.string(),
  title: z.string().nullable(),
  status: z.string(),
  priority: z.enum(PRIORITIES),
  created_at: z.string(),
  repeat_count: z.number(),
  deliveries: z.array(z.object({ channel: z.string(), channel_id: z.string(), target: z.string(), status: z.string(), detail: z.string().nullable(), reason: z.string().nullable() })),
  answers: z.number(),
  fallbacks: z.array(z.object({ id: z.string(), when: z.enum(FALLBACK_TRIGGERS), status: z.string(), due_at: z.string(), channels: z.array(z.string()), detail: z.string().nullable() })),
  watch_url: z.string().nullable(),
  notes: z.array(z.string()),
});

async function ownMessage(session: McpSession, id: string): Promise<MessageDTO | null> {
  const message = await getMessage(session.env.DB, session.user.id, id);
  return message && message.agentId === session.agent.id ? message : null;
}

function notFound(id: string) {
  return { content: [{ type: "text" as const, text: `No notification ${id} from this agent.` }], isError: true };
}

export function registerAgentTools(server: McpServer, session: McpSession | undefined): void {
  server.registerTool(
    "list_channels",
    {
      title: "List channels",
      description: "List the channels this agent can send to, with ids, names, kinds, topic threads, and how the user can answer on each. Use the id or name in notify.channels or in a fallback step.",
      inputSchema: z.object({}),
      outputSchema: z.object({ channels: z.array(channelSchema) }),
      annotations: { title: "List channels", readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      if (!session) throw new Error("Not authenticated");
      const all = await listChannels(session.env, session.user.id);
      const allowed = all.filter((c) => c.enabled && (!session.agent.channelIds || session.agent.channelIds.includes(c.id)));
      const routes = effectiveRoutes(session.user.settings, all);
      const channels = allowed.map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        ready: c.status === "ready",
        topic_threads: channelTargets(c).includes("topic"),
        text_message: CHANNEL_CATALOG[c.kind].isSms,
        answers: answersOn(c),
        routes: PRIORITIES.filter((p) => routes[p].some((d) => d.channelId === c.id)),
      }));
      const lines = channels.map(
        (c) => `${c.name} (${c.kind}, id ${c.id})${c.ready ? "" : ", needs setup"}${c.topic_threads ? ", topic threads" : ""}. ${c.answers}${c.routes.length ? ` Routes: ${c.routes.join(", ")}.` : ""}`,
      );
      return { content: [{ type: "text", text: lines.join("\n") || "No channels this agent can use." }], structuredContent: { channels } };
    },
  );

  server.registerTool(
    "notification_status",
    {
      title: "Check notification status",
      description: "Look up a notification this agent sent: where it went, delivery receipts, how many answers it has, and its fallback steps.",
      inputSchema: z.object({ id: z.string().min(1).max(64).describe("The id returned by notify.") }),
      outputSchema: statusOutput,
      annotations: { title: "Check notification status", readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      if (!session) throw new Error("Not authenticated");
      const message = await ownMessage(session, id);
      if (!message) return notFound(id);
      const output = {
        id: message.id,
        title: message.title,
        status: message.status,
        priority: message.priority,
        created_at: new Date(message.createdAt).toISOString(),
        repeat_count: message.repeatCount,
        deliveries: message.deliveries.map((d) => ({ channel: d.channelName, channel_id: d.channelId, target: d.target, status: d.status, detail: d.detail, reason: d.reason })),
        answers: message.interactions.length,
        fallbacks: message.fallbacks.map((f) => ({ id: f.id, when: f.when, status: f.status, due_at: new Date(f.dueAt).toISOString(), channels: f.channels, detail: f.detail })),
        watch_url: message.expectReply ? await watchUrl(session.env, session.origin, message.id) : null,
        notes: message.notes,
      };
      const lines = [
        `Status: ${output.status}. Answers: ${output.answers}${output.answers ? " (read them with get_replies)" : ""}.`,
        ...output.deliveries.map((d) => `${d.channel}${d.target === "topic" ? " (topic thread)" : ""}: ${d.status}${d.reason ? `, fallback: ${d.reason}` : ""}${d.detail ? ` (${d.detail})` : ""}`),
        ...output.fallbacks.map((f) => `Fallback ${f.when} to ${f.channels.join(", ")}: ${f.status}${f.status === "pending" ? ` at ${f.due_at}` : ""}${f.detail ? `. ${f.detail}` : ""}`),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: output };
    },
  );

  server.registerTool(
    "cancel_fallbacks",
    {
      title: "Cancel fallbacks",
      description: "Stop the pending fallback steps of a notification this agent sent, for example after the user answered somewhere else.",
      inputSchema: z.object({ message_id: z.string().min(1).max(64).describe("The id returned by notify.") }),
      outputSchema: z.object({ canceled: z.number() }),
      annotations: { title: "Cancel fallbacks", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ message_id }) => {
      if (!session) throw new Error("Not authenticated");
      if (!(await ownMessage(session, message_id))) return notFound(message_id);
      const canceled = await cancelFallbacks(session.env.DB, message_id, `${session.agent.name} canceled it.`);
      return { content: [{ type: "text", text: canceled ? `Canceled ${canceled} fallback step${canceled > 1 ? "s" : ""}.` : "No pending fallback steps." }], structuredContent: { canceled } };
    },
  );
}
