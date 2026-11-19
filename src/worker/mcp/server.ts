import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CHANNEL_KINDS } from "../../shared/channels";
import { PRIORITIES } from "../../shared/priority";
import type { Agent } from "../db/agents";
import { getMessage } from "../db/messages";
import type { User } from "../db/users";
import { notify, notifyInputShape, type RunContext } from "../core/notify";

export interface McpSession extends RunContext {
  user: User;
  agent: Agent;
}

export const SERVER_INSTRUCTIONS = `Beep Me sends your notifications to the user's phone, chat apps, and email.
Call notify when a long task finishes or fails, when you are blocked and need a decision, when something urgent happens, or when the user asked you to report back.
Skip routine progress steps. Send one message per event.
Priorities: urgent needs action now and can break through quiet hours. high is important and time sensitive and usually arrives as a text message. medium is worth seeing today and is the default. low is background information and goes to the topic's thread.
Set topic to a short project or subject name, such as the repository name. Each topic gets its own thread.
Lead the title with the outcome. Keep message to a few sentences. Add url when there is a page to open.
Beep Me applies the user's routing, quiet hours, and limits. The statuses collapsed, muted, paused, and throttled are normal results. Do not retry them.`;

const deliverySchema = z.object({
  channel: z.string(),
  kind: z.enum(CHANNEL_KINDS),
  target: z.enum(["main", "topic"]),
  ok: z.boolean(),
  detail: z.string().nullable(),
});

const notifyOutput = z.object({
  id: z.string(),
  status: z.enum(["delivered", "partial", "failed", "muted", "throttled", "paused", "collapsed"]),
  priority: z.enum(PRIORITIES),
  requested_priority: z.enum(PRIORITIES),
  topic: z.string().nullable(),
  quiet: z.boolean(),
  repeat_count: z.number(),
  deliveries: z.array(deliverySchema),
  notes: z.array(z.string()),
});

const statusOutput = z.object({
  id: z.string(),
  status: z.string(),
  priority: z.enum(PRIORITIES),
  created_at: z.string(),
  repeat_count: z.number(),
  deliveries: z.array(z.object({ channel: z.string(), target: z.string(), status: z.string(), detail: z.string().nullable() })),
  notes: z.array(z.string()),
});

function summary(result: z.infer<typeof notifyOutput>): string {
  const sent = result.deliveries.filter((d) => d.ok).map((d) => `${d.channel}${d.target === "topic" ? " (topic thread)" : ""}`);
  const failed = result.deliveries.filter((d) => !d.ok).map((d) => `${d.channel}: ${d.detail ?? "failed"}`);
  const lines = [`Status: ${result.status}. Priority: ${result.priority}.`];
  if (sent.length) lines.push(`Delivered to ${sent.join(", ")}.`);
  if (failed.length) lines.push(`Failed: ${failed.join("; ")}.`);
  lines.push(...result.notes);
  return lines.join("\n");
}

export function buildServer(session: McpSession | undefined): McpServer {
  const origin = session?.origin ?? "https://beep-me.invalid";
  const server = new McpServer(
    { name: "beep-me", title: "Beep Me", version: "0.1.0", websiteUrl: origin, icons: [{ src: `${origin}/icon.svg`, mimeType: "image/svg+xml" }] },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "notify",
    {
      title: "Send notification",
      description:
        "Send a notification to the user through Beep Me (text message, Telegram, email, Slack, Discord or push, chosen by the user's rules). Use it when work finishes, fails, or needs the user. Returns where it was delivered.",
      inputSchema: z.object({
        message: notifyInputShape.message.describe("The notification body. A few sentences at most."),
        title: notifyInputShape.title.describe("Short headline that leads with the outcome, for example 'Deploy finished'."),
        priority: notifyInputShape.priority.describe("urgent: act now. high: important, time sensitive. medium: today (default). low: FYI."),
        topic: notifyInputShape.topic.describe("Project or subject name, for example the repo name. Each topic gets its own thread."),
        url: notifyInputShape.url.describe("Optional link to open, for example a pull request or dashboard."),
        dedupe_key: notifyInputShape.dedupe_key.describe("Optional. Messages with the same key inside the collapse window are merged."),
      }),
      outputSchema: notifyOutput,
      annotations: { title: "Send notification", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      if (!session) throw new Error("Not authenticated");
      const result = await notify(session, session.user, { agent: session.agent, name: session.agent.name, source: "mcp" }, input);
      return { content: [{ type: "text", text: summary(result) }], structuredContent: result };
    },
  );

  server.registerTool(
    "notification_status",
    {
      title: "Check notification status",
      description: "Look up a notification this agent sent earlier, including delivery receipts for text messages.",
      inputSchema: z.object({ id: z.string().min(1).max(64).describe("The id returned by notify.") }),
      outputSchema: statusOutput,
      annotations: { title: "Check notification status", readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      if (!session) throw new Error("Not authenticated");
      const message = await getMessage(session.env.DB, session.user.id, id);
      if (!message || message.agentId !== session.agent.id) {
        return { content: [{ type: "text", text: `No notification ${id} from this agent.` }], isError: true };
      }
      const output = {
        id: message.id,
        status: message.status,
        priority: message.priority,
        created_at: new Date(message.createdAt).toISOString(),
        repeat_count: message.repeatCount,
        deliveries: message.deliveries.map((d) => ({ channel: d.channelName, target: d.target, status: d.status, detail: d.detail })),
        notes: message.notes,
      };
      const lines = output.deliveries.map((d) => `${d.channel}: ${d.status}${d.detail ? ` (${d.detail})` : ""}`);
      return { content: [{ type: "text", text: [`Status: ${output.status}.`, ...lines].join("\n") }], structuredContent: output };
    },
  );

  server.registerPrompt(
    "notify-when-done",
    {
      title: "Notify me when done",
      description: "Ask the agent to send a Beep Me notification when the current task finishes or gets stuck.",
      argsSchema: z.object({ topic: z.string().optional().describe("Topic for the notification, for example the project name.") }),
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `When you finish the current task, call the Beep Me notify tool with priority medium, a title that states the outcome, and a short summary.${topic ? ` Use the topic "${topic}".` : " Use the project name as the topic."} If you get blocked or need my decision before then, notify me right away with priority high and say what you need.`,
          },
        },
      ],
    }),
  );

  return server;
}
