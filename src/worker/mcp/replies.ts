import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CHANNEL_KINDS } from "../../shared/channels";
import type { InteractionDTO, MatchedBy } from "../../shared/api";
import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import { answeredMessages, fetchReplies, imageBlocks, type AnsweredMessage } from "../core/replies";
import type { McpSession } from "./server";

const mediaSchema = z.object({ kind: z.enum(["image", "audio", "video", "file"]), name: z.string(), mime: z.string(), size: z.number().nullable(), url: z.string() });

const MATCHED_BY = ["reply", "button", "reaction", "latest", "address", "dashboard"] as const satisfies readonly MatchedBy[];

const replySchema = z.object({
  id: z.string(),
  message_id: z.string().nullable(),
  kind: z.enum(["reply", "choice", "reaction", "vote"]),
  text: z.string().nullable(),
  option: z.object({ index: z.number(), label: z.string() }).nullable(),
  media: z.array(mediaSchema),
  channel: z.enum(CHANNEL_KINDS),
  sender: z.string().nullable(),
  created_at: z.string(),
  from: z.object({
    channel_id: z.string(),
    channel_name: z.string().nullable(),
    channel_kind: z.enum(CHANNEL_KINDS),
    matched_by: z.enum(MATCHED_BY).nullable(),
  }),
  in_reply_to: z
    .object({ message_id: z.string(), title: z.string().nullable(), topic: z.string().nullable(), sent_at: z.string(), sent_to: z.array(z.string()) })
    .nullable(),
});

const HOW: Record<MatchedBy, string> = {
  reply: "answered that message directly",
  button: "tapped an option button",
  reaction: "reacted to that message",
  latest: "wrote in the chat; Beep Me matched it to the newest message there that waited for an answer, so check it fits",
  address: "emailed your agent address; it is not tied to one message",
  dashboard: "answered in the Beep Me dashboard",
};

function describe(reply: InteractionDTO, message: AnsweredMessage | undefined): string {
  const what = reply.option ? `chose "${reply.option.label}"` : reply.kind === "reaction" ? `reacted ${reply.text ?? ""}` : `replied: ${reply.text ?? "(no text)"}`;
  const files = reply.media.length ? ` (${reply.media.length} file${reply.media.length > 1 ? "s" : ""})` : "";
  const where = reply.matchedBy === "dashboard" ? "in the Beep Me dashboard" : `on ${CHANNEL_CATALOG[reply.channelKind].name}${reply.channelName ? ` "${reply.channelName}"` : ""}`;
  const how = reply.matchedBy ? ` It ${HOW[reply.matchedBy]}.` : "";
  const about = message
    ? ` In reply to ${message.message_id}${message.title ? ` "${message.title}"` : ""}${message.topic ? `, topic ${message.topic}` : ""}, sent to ${message.sent_to.join(", ") || "no channel"}.`
    : " Not tied to any message you sent.";
  return `[${new Date(reply.createdAt).toISOString()}] ${reply.sender ?? "User"} ${what}${files} ${where}.${how}${about}`;
}

const outputSchema = z.object({ replies: z.array(replySchema), waited_seconds: z.number() });

export const getRepliesInput = z.object({
  message_id: z.string().max(64).optional().describe("Only answers to this notification. Use the id that notify returned."),
  since: z.string().datetime({ offset: true }).optional().describe("Only answers after this time, ISO 8601."),
  wait_seconds: z.number().int().min(0).max(50).default(0).describe("Wait up to this many seconds for an answer. 0 returns at once."),
  include_read: z.boolean().default(false).describe("Also return answers you already read."),
  limit: z.number().int().min(1).max(50).default(20),
});

export function registerReplyTools(server: McpServer, session: McpSession | undefined): void {
  server.registerTool(
    "get_replies",
    {
      title: "Get replies",
      description:
        "Read what the user sent back to your notifications: text replies, chosen options, reactions, and files. Each answer has from (the channel it arrived on and how Beep Me matched it) and in_reply_to (the message it answers and every channel that message went to). Returns unread answers and marks them read. Set wait_seconds to wait for an answer.",
      inputSchema: getRepliesInput,
      outputSchema,
      annotations: { title: "Get replies", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (input) => {
      if (!session) throw new Error("Not authenticated");
      const batch = await fetchReplies(session.env, session.origin, session.agent.id, {
        messageId: input.message_id,
        since: input.since ? Date.parse(input.since) : undefined,
        waitSeconds: input.wait_seconds,
        includeRead: input.include_read,
        limit: input.limit,
      });
      const messages = await answeredMessages(session.env.DB, batch.replies.flatMap((reply) => (reply.messageId ? [reply.messageId] : [])));
      const replies = batch.replies.map((reply) => ({
        id: reply.id,
        message_id: reply.messageId,
        kind: reply.kind,
        text: reply.text,
        option: reply.option,
        media: reply.media,
        channel: reply.channelKind,
        sender: reply.sender,
        created_at: new Date(reply.createdAt).toISOString(),
        from: { channel_id: reply.channelId, channel_name: reply.channelName, channel_kind: reply.channelKind, matched_by: reply.matchedBy },
        in_reply_to: (reply.messageId && messages.get(reply.messageId)) || null,
      }));
      const lines = batch.replies.length
        ? batch.replies.map((reply) => describe(reply, reply.messageId ? messages.get(reply.messageId) : undefined))
        : [`No new replies after ${batch.waitedSeconds} seconds.`];
      const images = await imageBlocks(session.env, batch.rows);
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }, ...images],
        structuredContent: { replies, waited_seconds: batch.waitedSeconds },
      };
    },
  );
}
