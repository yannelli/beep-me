import type { AttachmentDTO, AttachmentKind } from "../../shared/api";
import type { OutboundAttachment } from "../channels/types";
import { randomString } from "../lib/crypto";

const PREFIX = "media:";
const TTL_SECONDS = 7 * 86_400;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const EXTENSION_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", svg: "image/svg+xml",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  pdf: "application/pdf", txt: "text/plain", csv: "text/csv", json: "application/json", zip: "application/zip", md: "text/markdown",
};

export function guessMime(name: string): string {
  return EXTENSION_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
}

export function attachmentKind(mime: string): AttachmentKind {
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "file";
}

/** Stores bytes for 7 days and returns a public, unguessable URL that providers such as Telnyx can fetch. */
export async function storeMedia(env: Env, origin: string, bytes: Uint8Array, mime: string, name: string): Promise<AttachmentDTO> {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`Attachments must be 20 MB or smaller. ${name} is ${Math.ceil(bytes.byteLength / 1048576)} MB.`);
  const id = randomString(32);
  const fileName = safeFileName(name);
  await env.OAUTH_KV.put(`${PREFIX}${id}`, bytes, { expirationTtl: TTL_SECONDS, metadata: { mime, name: fileName } });
  return { kind: attachmentKind(mime), name: fileName, mime, size: bytes.byteLength, url: `${origin}/media/${id}/${encodeURIComponent(fileName)}` };
}

export async function serveMedia(env: Env, id: string): Promise<Response> {
  if (!/^[0-9A-Za-z]{32}$/.test(id)) return new Response("Not found", { status: 404 });
  const { value, metadata } = await env.OAUTH_KV.getWithMetadata<{ mime: string; name: string }>(`${PREFIX}${id}`, "arrayBuffer");
  if (!value || !metadata) return new Response("Not found", { status: 404 });
  return new Response(value, {
    headers: {
      "content-type": metadata.mime,
      "content-disposition": `inline; filename="${metadata.name}"`,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}

async function loadUrl(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > MAX_ATTACHMENT_BYTES) throw new Error(`${url} is larger than 20 MB.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`${url} is larger than 20 MB.`);
  return bytes;
}

export function toOutboundAttachment(env: Env, origin: string, attachment: AttachmentDTO): OutboundAttachment {
  const stored = attachment.url.startsWith(`${origin}/media/`) ? attachment.url.slice(origin.length + 7).split("/")[0] : null;
  return {
    ...attachment,
    async load() {
      if (!stored) return loadUrl(attachment.url);
      const value = await env.OAUTH_KV.get(`${PREFIX}${stored}`, "arrayBuffer");
      if (!value) throw new Error(`${attachment.name} expired. Uploaded files are kept for 7 days.`);
      return new Uint8Array(value);
    },
  };
}
