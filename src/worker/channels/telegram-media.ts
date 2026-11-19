import { attachmentKind } from "../core/media";
import { TelegramApiError, fileDownloadUrl, tg, tgForm, type TgDocument, type TgFileBase, type TgMessage } from "./telegram-api";
import type { InboundMedia, OutboundAttachment } from "./types";

type FileType = "photo" | "video" | "audio" | "voice" | "document";

interface LoadedFile {
  attachment: OutboundAttachment;
  bytes: Uint8Array;
  type: FileType;
}

const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const ALBUM_MAX_ITEMS = 10;
/** Bytes held in memory for one upload request. Workers have 128 MB. */
const BATCH_MAX_BYTES = 30 * 1024 * 1024;
const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AUDIO_MIMES = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a"]);
const METHOD: Record<FileType, string> = { photo: "sendPhoto", video: "sendVideo", audio: "sendAudio", voice: "sendVoice", document: "sendDocument" };

function fileType(mime: string, size: number): FileType {
  if (PHOTO_MIMES.has(mime) && size <= PHOTO_MAX_BYTES) return "photo";
  if (mime === "video/mp4") return "video";
  if (AUDIO_MIMES.has(mime)) return "audio";
  if (mime === "audio/ogg") return "voice";
  return "document";
}

/** Telegram albums mix photos and videos, or hold only documents, or only audio. Voice notes do not go in albums. */
function albumGroup(type: FileType): string | null {
  if (type === "photo" || type === "video") return "visual";
  return type === "voice" ? null : type;
}

export async function loadFile(attachment: OutboundAttachment): Promise<LoadedFile> {
  const bytes = await attachment.load();
  return { attachment, bytes, type: fileType(attachment.mime, bytes.byteLength) };
}

export function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toForm(params: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return form;
}

function appendFile(form: FormData, field: string, file: LoadedFile): void {
  form.append(field, new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.attachment.mime }), file.attachment.name);
}

/** Uploads one file. A photo that Telegram rejects (for example its dimensions) goes again as a document. */
export async function sendFile(token: string, params: Record<string, unknown>, file: LoadedFile): Promise<TgMessage> {
  const form = toForm(params);
  appendFile(form, file.type, file);
  try {
    return await tgForm<TgMessage>(token, METHOD[file.type], form);
  } catch (error) {
    if (file.type !== "photo" || !(error instanceof TelegramApiError) || error.code !== 400) throw error;
    return sendFile(token, params, { ...file, type: "document" });
  }
}

async function sendAlbum(token: string, params: Record<string, unknown>, files: LoadedFile[]): Promise<TgMessage[]> {
  const form = toForm({ ...params, media: files.map((file, index) => ({ type: file.type, media: `attach://file${index}` })) });
  files.forEach((file, index) => appendFile(form, `file${index}`, file));
  return tgForm<TgMessage[]>(token, "sendMediaGroup", form);
}

/** Uploads attachments as albums where Telegram allows it, else one by one. Failures are returned as text, not thrown. */
export async function sendFiles(
  token: string,
  params: Record<string, unknown>,
  attachments: OutboundAttachment[],
): Promise<{ firstMessageId: number | null; failures: string[] }> {
  const failures: string[] = [];
  let firstMessageId: number | null = null;
  let batch: LoadedFile[] = [];
  let batchBytes = 0;
  const flush = async () => {
    const files = batch;
    batch = [];
    batchBytes = 0;
    if (!files.length) return;
    try {
      const sent = files.length === 1 ? [await sendFile(token, params, files[0]!)] : await sendAlbum(token, params, files);
      firstMessageId ??= sent[0]?.message_id ?? null;
    } catch (error) {
      failures.push(`${files.map((file) => file.attachment.name).join(", ")}: ${failureText(error)}`);
    }
  };
  for (const attachment of attachments) {
    let file: LoadedFile;
    try {
      file = await loadFile(attachment);
    } catch (error) {
      failures.push(`${attachment.name}: ${failureText(error)}`);
      continue;
    }
    const group = albumGroup(file.type);
    const head = batch[0];
    const full = batch.length >= ALBUM_MAX_ITEMS || batchBytes + file.bytes.byteLength > BATCH_MAX_BYTES;
    if (head && (group === null || albumGroup(head.type) !== group || full)) await flush();
    batch.push(file);
    batchBytes += file.bytes.byteLength;
    if (group === null) await flush();
  }
  await flush();
  return { firstMessageId, failures };
}

/** Files on an inbound message. Photos use the largest size Telegram offers. */
export function inboundMedia(message: TgMessage): InboundMedia[] {
  const media: InboundMedia[] = [];
  const photo = message.photo?.reduce((best, size) => (size.width * size.height > best.width * best.height ? size : best));
  if (photo) media.push({ kind: "image", name: `photo-${message.message_id}.jpg`, mime: "image/jpeg", size: photo.file_size ?? null, ref: photo.file_id });
  const files: [TgDocument | TgFileBase | undefined, string, string][] = [
    [message.animation ? undefined : message.document, "file", "application/octet-stream"],
    [message.animation, "animation.mp4", "video/mp4"],
    [message.voice, "voice.ogg", "audio/ogg"],
    [message.audio, "audio.mp3", "audio/mpeg"],
    [message.video, "video.mp4", "video/mp4"],
    [message.video_note, "video-note.mp4", "video/mp4"],
  ];
  for (const [file, fallbackName, fallbackMime] of files) {
    if (!file) continue;
    const details = file as TgDocument;
    const mime = details.mime_type ?? fallbackMime;
    const name = details.file_name ?? `${message.message_id}-${fallbackName}`;
    media.push({ kind: attachmentKind(mime), name, mime, size: file.file_size ?? null, ref: file.file_id });
  }
  return media;
}

/** Streams a file the user sent. Bots can download up to 20 MB. The download URL holds the token, so errors return a bare status. */
export async function fetchTelegramFile(token: string, fileId: string): Promise<Response> {
  let filePath: string | undefined;
  try {
    filePath = (await tg<{ file_path?: string }>(token, "getFile", { file_id: fileId })).file_path;
  } catch (error) {
    if (!(error instanceof TelegramApiError)) throw error;
    return new Response(null, { status: /too big/i.test(error.description) ? 413 : 502 });
  }
  if (!filePath) return new Response(null, { status: 404 });
  const response = await fetch(fileDownloadUrl(token, filePath), { signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return response ?? new Response(null, { status: 502 });
}
