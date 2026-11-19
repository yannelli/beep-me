import { http } from "./http";
import type { ChannelAdapter } from "./types";

export const webhook: ChannelAdapter<"webhook"> = {
  kind: "webhook",

  async send(ctx, message) {
    const body = JSON.stringify({
      event: "notification",
      id: message.id,
      title: message.title,
      body: message.body,
      priority: message.priority,
      topic: message.topic,
      url: message.url,
      agent: message.agent,
      silent: message.silent,
      test: message.test,
      createdAt: message.createdAt,
      attachments: message.attachments.map(({ name, mime, size, url }) => ({ name, mime, size, url })),
      options: message.options,
      expect_reply: message.expectReply,
      sender_name: message.senderName,
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "user-agent": "BeepMe/0.1",
      "x-beepme-timestamp": timestamp,
    };
    if (ctx.config.secret) headers["x-beepme-signature"] = `sha256=${await hmacSha256Hex(ctx.config.secret, `${timestamp}.${body}`)}`;
    const response = await http(ctx.config.url, { method: "POST", headers, body });
    if (response.status === 0) return { ok: false, detail: response.text };
    return { ok: response.ok, detail: `HTTP ${response.status}` };
  },
};

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
