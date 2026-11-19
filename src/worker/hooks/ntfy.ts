import { Hono } from "hono";
import type { AppEnv } from "../auth/session";
import { ntfyChoiceSignature } from "../channels/ntfy";
import { getChannel } from "../db/channels";
import { recordInteraction } from "../db/interactions";
import { timingSafeEqual } from "../lib/crypto";

export const ntfyHook = new Hono<AppEnv>();

/** ntfy action buttons POST here. The URL carries an HMAC of the channel, message, and option index. */
ntfyHook.post("/:channelId/:messageId/:option/:signature", async (c) => {
  const { channelId, messageId, option, signature } = c.req.param();
  const index = Number(option);
  if (!/^\d{1,2}$/.test(option)) return c.json({ ok: false }, 403);
  const expected = await ntfyChoiceSignature(c.env.APP_SECRET, channelId, messageId, index);
  if (!timingSafeEqual(expected, signature)) return c.json({ ok: false }, 403);
  const channel = await getChannel(c.env, null, channelId);
  if (!channel || channel.kind !== "ntfy") return c.json({ ok: false }, 404);
  const message = await c.env.DB.prepare("SELECT options FROM messages WHERE id = ? AND user_id = ?")
    .bind(messageId, channel.userId)
    .first<{ options: string }>();
  if (!message || index >= (JSON.parse(message.options) as string[]).length) return c.json({ ok: false }, 404);
  await recordInteraction(c.env.DB, {
    userId: channel.userId,
    channelId,
    channelKind: "ntfy",
    messageId,
    kind: "choice",
    text: null,
    optionIndex: index,
    media: [],
    sender: null,
    providerRef: `choice:${messageId}:${index}`,
  });
  return c.json({ ok: true });
});
