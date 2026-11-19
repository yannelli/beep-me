import { McpServer } from "@modelcontextprotocol/server";
import { version } from "../../../package.json";
import { z } from "zod";
import { CHANNEL_KINDS } from "../../shared/channels";
import { PRIORITIES } from "../../shared/priority";
import { FALLBACK_TRIGGERS } from "../../shared/settings";
import type { Agent } from "../db/agents";
import type { User } from "../db/users";
import { notify, notifyInputShape, type RunContext } from "../core/notify";
import { registerAgentTools } from "./agent-tools";
import { registerGuides } from "./guides";
import { registerReplyTools } from "./replies";

export interface McpSession extends RunContext {
  user: User;
  agent: Agent;
  /** The client runs the Beep Me plugin (X-Beep-Me-Plugin header), which waits for answers itself. */
  plugin?: boolean;
}

export const SERVER_INSTRUCTIONS = `Beep Me sends your notifications to the user's phone, chat apps, and email, and brings their answers back to you.
Call notify when a long task finishes or fails, when you are blocked and need a decision, when something urgent happens, or when the user asked you to report back. Skip routine progress. Send one message per event.
Priorities: urgent needs action now and can break through quiet hours. high is important and time sensitive and usually arrives as a text message. medium is worth seeing today and is the default. low is background information.
Set topic to a short project name, such as the repository name. Lead the title with the outcome. Keep message to a few sentences. Add url when there is a page to open.
The user's routes pick the channels. To pick them yourself, call list_channels and pass ids or names in notify.channels. topic_thread true sends into the topic's thread.
To ask something, send notify with options or expect_reply true, then read answers with get_replies. Each answer says which message it answers (in_reply_to) and where it came from (from.channel_name, from.matched_by). matched_by latest is a guess.
To wait for an answer without spending tokens, run the watch loop from the notify result in a background shell, then call get_replies once. Without a shell, call get_replies with wait_seconds up to 50 a few times, or end your turn.
fallbacks on notify send the message again elsewhere when nobody answers or a send fails. cancel_fallbacks stops them.
The statuses collapsed, muted, paused, and throttled are normal results. Do not retry them.
Call help for guides with examples. Topics: overview, notify, channels, topics, replies, waiting, fallbacks, examples.`;

const deliverySchema = z.object({
  channel: z.string(),
  channel_id: z.string(),
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
  fallbacks: z.array(z.object({ id: z.string(), when: z.enum(FALLBACK_TRIGGERS), after_minutes: z.number(), due_at: z.string(), channels: z.array(z.string()) })),
  watch_url: z.string().nullable(),
  notes: z.array(z.string()),
});

/** Waits up to 90 minutes, then exits 0 when an answer is ready or 2 when none came. */
export function watchLoop(url: string): string {
  return `W='${url}'; end=$((SECONDS+5400)); while [ $SECONDS -lt $end ]; do r=$(curl -fsS --max-time 70 "$W?wait_seconds=50") && case "$r" in *'"ready":true'*) echo "$r"; exit 0;; esac || sleep 15; done; echo "No answer after 90 minutes."; exit 2`;
}

function summary(result: z.infer<typeof notifyOutput>, awaitsReply: boolean, plugin: boolean): string {
  const sent = result.deliveries.filter((d) => d.ok).map((d) => `${d.channel} (${d.kind}${d.target === "topic" ? ", topic thread" : ""})`);
  const failed = result.deliveries.filter((d) => !d.ok).map((d) => `${d.channel}: ${d.detail ?? "failed"}`);
  const lines = [`Message ${result.id}. Status: ${result.status}. Priority: ${result.priority}.${result.topic ? ` Topic: ${result.topic}.` : ""}`];
  if (sent.length) lines.push(`Delivered to ${sent.join(", ")}.`);
  if (failed.length) lines.push(`Failed: ${failed.join("; ")}.`);
  for (const step of result.fallbacks) lines.push(`Fallback: if ${step.when.replace("_", " ")} by ${step.due_at}, send to ${step.channels.join(", ")}.`);
  lines.push(...result.notes);
  if (awaitsReply && plugin) {
    lines.push("The Beep Me plugin waits for the answer and sends it to you as a new message. Keep working or end your turn. Do not call get_replies or run a watch loop for this message.");
  } else if (awaitsReply) {
    lines.push(`Answers can come from any channel above. Read them with get_replies and message_id "${result.id}".`);
    if (result.watch_url) lines.push(`To wait without spending tokens, run this in a background shell. It exits 0 when an answer is ready:\n${watchLoop(result.watch_url)}`);
  }
  return lines.join("\n");
}

export function buildServer(session: McpSession | undefined): McpServer {
  const origin = session?.origin ?? "https://beep-me.invalid";
  const server = new McpServer(
    { name: "beep-me", title: "Beep Me", version, websiteUrl: origin, icons: [{ src: `${origin}/icon.svg`, mimeType: "image/svg+xml" }] },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "notify",
    {
      title: "Send notification",
      description:
        "Send a notification to the user through Beep Me (text message, Telegram, email, Slack, Discord or push). The user's routes pick the channels unless you pass channels. Use it when work finishes, fails, or needs the user. Returns the message id, where it went, the fallback steps, and a watch URL for questions.",
      inputSchema: z.object({
        message: notifyInputShape.message.describe("The notification body. A few sentences at most."),
        title: notifyInputShape.title.describe("Short headline that leads with the outcome, for example 'Deploy finished'."),
        priority: notifyInputShape.priority.describe("urgent: act now. high: important, time sensitive. medium: today (default). low: FYI."),
        topic: notifyInputShape.topic.describe("Project or subject name, for example the repo name. Each topic gets its own thread."),
        url: notifyInputShape.url.describe("Optional link to open, for example a pull request or dashboard."),
        dedupe_key: notifyInputShape.dedupe_key.describe("Optional. Messages with the same key inside the collapse window are merged."),
        attachments: notifyInputShape.attachments.describe("Optional files: screenshots, logs, reports. Up to 10."),
        options: notifyInputShape.options.describe("Optional choices for a question, 2 to 10, each up to 64 characters. Read the answer with get_replies."),
        expect_reply: notifyInputShape.expect_reply.describe("Set true when you want a written answer. Read it with get_replies."),
        sender_name: notifyInputShape.sender_name.describe("Optional display name for this message, for example a project name like 'Cat Design Project'."),
        channels: notifyInputShape.channels.describe("Optional. Up to 5 channel ids, names, or kinds (like telegram) to send to instead of the user's route. list_channels shows them."),
        topic_thread: notifyInputShape.topic_thread.describe("Set true to send into the topic's thread on channels that have threads."),
        fallbacks: notifyInputShape.fallbacks.describe("Optional steps that send the message again elsewhere when nobody answers or a send fails. They replace the user's steps for this message. [] turns them off."),
      }),
      outputSchema: notifyOutput,
      annotations: { title: "Send notification", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) => {
      if (!session) throw new Error("Not authenticated");
      const result = await notify(session, session.user, { agent: session.agent, name: session.agent.name, source: "mcp" }, input);
      const awaitsReply = Boolean(input.expect_reply || input.options?.length) && ["delivered", "partial"].includes(result.status);
      return { content: [{ type: "text", text: summary(result, awaitsReply, session.plugin === true) }], structuredContent: result };
    },
  );

  registerReplyTools(server, session);
  registerAgentTools(server, session);
  registerGuides(server);

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
