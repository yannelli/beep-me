import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CHANNEL_KINDS } from "../../shared/channels";
import { fetchReplies, imageBlocks } from "../core/replies";
import type { McpSession } from "./server";

const mediaSchema = z.object({ kind: z.enum(["image", "audio", "video", "file"]), name: z.string(), mime: z.string(), size: z.number().nullable(), url: z.string() });

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
});

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
        "Read what the user sent back to your notifications: text replies, chosen options, reactions, and files. Returns unread answers and marks them read. Set wait_seconds to wait for an answer.",
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
      }));
      const lines = replies.length
        ? replies.map((reply) => {
            const what = reply.option ? `chose "${reply.option.label}"` : reply.kind === "reaction" ? `reacted ${reply.text ?? ""}` : `replied: ${reply.text ?? "(no text)"}`;
            const files = reply.media.length ? ` (${reply.media.length} file${reply.media.length > 1 ? "s" : ""})` : "";
            return `[${reply.created_at}] ${reply.sender ?? "User"} ${what}${files} via ${reply.channel}, message ${reply.message_id ?? "unmatched"}`;
          })
        : [`No new replies after ${batch.waitedSeconds} seconds.`];
      const images = await imageBlocks(session.env, batch.rows);
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }, ...images],
        structuredContent: { replies, waited_seconds: batch.waitedSeconds },
      };
    },
  );
}
