import { z } from "zod";
import type { AttachmentDTO } from "../../shared/api";
import { PRIORITIES } from "../../shared/priority";
import { FALLBACK_TRIGGERS } from "../../shared/settings";
import { fromBase64url } from "../lib/crypto";
import { attachmentKind, guessMime, safeFileName, storeMedia } from "./media";

export const httpUrl = z.string().trim().max(2000).url().refine((value) => /^https?:\/\//i.test(value), "Use an http or https URL.");

const attachmentInput = z
  .object({
    url: httpUrl.optional().describe("Public URL of the file."),
    data: z.string().max(28_000_000).optional().describe("The file as base64 (a data: URL works too). Up to 20 MB."),
    filename: z.string().trim().max(200).optional().describe("File name to show, for example screenshot.png."),
    mime_type: z.string().trim().max(120).optional().describe("MIME type, for example image/png. Guessed from the name when missing."),
  })
  .refine((value) => Boolean(value.url) !== Boolean(value.data), "Give url or data, not both.");

/** A channel id, a channel name (any case), or a channel kind such as telegram, which picks every channel of that kind. */
const channelRef = z.string().trim().min(1).max(80);

const fallbackInput = z.object({
  when: z.enum(FALLBACK_TRIGGERS).describe("no_reply: nobody answered, tapped a button, or reacted. failed: every send failed. unconfirmed: no delivery receipt (text messages) or a failed send."),
  after_minutes: z.number().int().min(0).max(1440).describe("Minutes after the first send. Beep Me checks every minute."),
  channels: z.array(channelRef).min(1).max(5).describe("Where to send it: channel ids, names, or kinds. list_channels shows them."),
  priority: z.enum(PRIORITIES).optional().describe("Send the fallback at this priority, for example urgent to break through quiet hours."),
});

/** Fields that notify accepts beyond the basic message. Shared by MCP and POST /v1/notify. */
export const notifyExtrasShape = {
  attachments: z.array(attachmentInput).max(10).optional(),
  options: z.array(z.string().trim().min(1).max(64)).min(2).max(10).optional(),
  expect_reply: z.boolean().optional(),
  sender_name: z.string().trim().min(1).max(80).optional(),
  channels: z.array(channelRef).min(1).max(5).optional(),
  topic_thread: z.boolean().optional(),
  fallbacks: z.array(fallbackInput).max(5).optional(),
};

export type FallbackInput = z.infer<typeof fallbackInput>;

export type AttachmentInput = z.infer<typeof attachmentInput>;

function decodeBase64(data: string): Uint8Array {
  const body = data.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  return fromBase64url(body.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""));
}

export async function prepareAttachments(env: Env, origin: string, inputs: AttachmentInput[] | undefined): Promise<AttachmentDTO[]> {
  const out: AttachmentDTO[] = [];
  for (const input of inputs ?? []) {
    const dataMime = /^data:([^;,]+)/.exec(input.data ?? "")?.[1];
    if (input.data) {
      const name = safeFileName(input.filename ?? "attachment");
      const mime = input.mime_type ?? dataMime ?? guessMime(name);
      out.push(await storeMedia(env, origin, decodeBase64(input.data), mime, name));
      continue;
    }
    const url = input.url!;
    const name = safeFileName(input.filename ?? decodeURIComponent(new URL(url).pathname.split("/").pop() || "attachment"));
    const mime = input.mime_type ?? guessMime(name);
    out.push({ kind: attachmentKind(mime), name, mime, size: null, url });
  }
  return out;
}
