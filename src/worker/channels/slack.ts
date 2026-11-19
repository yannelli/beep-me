import { clip, errorText, http, isHttpUrl } from "./http";
import { escapeSlack, slackMrkdwn } from "./render";
import type { ChannelAdapter, OutboundAttachment, OutboundMessage } from "./types";

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/gif"]);
const MAX_IMAGES = 5;
const SECTION_MAX = 3000;

export const slack: ChannelAdapter<"slack"> = {
  kind: "slack",

  async send(ctx, message) {
    const images = message.attachments.filter(isSlackImage).slice(0, MAX_IMAGES);
    let response = await post(ctx.config.webhookUrl, message, images);
    if (response.status === 400 && images.length) response = await post(ctx.config.webhookUrl, message, []);
    if (!response.ok) return { ok: false, detail: `Slack ${response.status}: ${errorText(response)}` };
    return { ok: true };
  },
};

/** Slack downloads image_url itself and rejects the whole message when it cannot, so a failed post retries with links. */
function post(webhookUrl: string, message: OutboundMessage, images: OutboundAttachment[]) {
  const { fallback, section, context } = slackMrkdwn(message);
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: section } }];
  for (const image of images) {
    blocks.push({ type: "image", image_url: image.url, alt_text: clip(image.name, 2000), title: { type: "plain_text", text: clip(image.name, 2000) } });
  }
  const files = message.attachments.filter((attachment) => !images.includes(attachment));
  if (files.length) blocks.push(mrkdwnSection(files.map((file) => `\u{1F4CE} ${slackLink(file.url, file.name)}`).join("\n")));
  if (message.options.length || message.expectReply) blocks.push(mrkdwnSection(choicesText(message)));
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: context }] });
  if (isHttpUrl(message.url) && message.url.length <= 3000) {
    blocks.push({
      type: "actions",
      elements: [{ type: "button", text: { type: "plain_text", text: "Open link" }, url: message.url, action_id: "beepme_open_link" }],
    });
  }
  return http(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: fallback, blocks }),
  });
}

function isSlackImage(attachment: OutboundAttachment): boolean {
  return IMAGE_MIMES.has(attachment.mime) && attachment.url.startsWith("https://") && attachment.url.length <= 3000;
}

function choicesText(message: OutboundMessage): string {
  const list = message.options.map((option, index) => `${index + 1}. ${escapeSlack(option)}`).join("\n");
  const note = `${slackLink(message.appUrl, "Answer in the Beep Me dashboard")}.`;
  return list ? `${list}\n${note}` : note;
}

function slackLink(url: string, label: string): string {
  return isHttpUrl(url) ? `<${url}|${escapeSlack(label).replace(/\|/g, "/")}>` : escapeSlack(label);
}

function mrkdwnSection(text: string) {
  return { type: "section", text: { type: "mrkdwn", text: clip(text, SECTION_MAX) } };
}
