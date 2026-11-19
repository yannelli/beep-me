import { errorText, http, isHttpUrl } from "./http";
import { slackMrkdwn } from "./render";
import type { ChannelAdapter } from "./types";

export const slack: ChannelAdapter<"slack"> = {
  kind: "slack",

  async send(ctx, message) {
    const { fallback, section, context } = slackMrkdwn(message);
    const blocks: unknown[] = [
      { type: "section", text: { type: "mrkdwn", text: section } },
      { type: "context", elements: [{ type: "mrkdwn", text: context }] },
    ];
    if (isHttpUrl(message.url) && message.url.length <= 3000) {
      blocks.push({
        type: "actions",
        elements: [{ type: "button", text: { type: "plain_text", text: "Open link" }, url: message.url, action_id: "beepme_open_link" }],
      });
    }
    const response = await http(ctx.config.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: fallback, blocks }),
    });
    if (!response.ok) return { ok: false, detail: `Slack ${response.status}: ${errorText(response)}` };
    return { ok: true };
  },
};
