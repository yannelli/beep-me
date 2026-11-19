import { errorText, http, isRecord, type HttpResponse } from "./http";
import { base64, encodeSubject, planAttachments, renderEmail, utf8, type EmailContent, type PlannedFile } from "./render-email";
import { EMAIL_ATTACHMENT_BUDGET, sendSmtp } from "./smtp";
import type { ChannelAdapter, SendContext, SendResult } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const UPLOAD_URL = "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media";
const REVOKED = "Google access was revoked. Connect Gmail again.";
const NOT_CONNECTED = "Gmail is not connected yet. Connect Gmail to send email.";
const EXPIRY_MARGIN_MS = 60_000;

export const gmail: ChannelAdapter<"gmail"> = {
  kind: "gmail",

  async send(ctx, message) {
    const config = ctx.config;
    const { files, links } = await planAttachments(message.attachments, EMAIL_ATTACHMENT_BUDGET);
    const content = renderEmail(message, { subjectPrefix: config.subjectPrefix, links });
    if (config.mode === "app_password") {
      const { email, appPassword } = config;
      return sendSmtp({ host: "smtp.gmail.com", port: 465, security: "tls", username: email, password: appPassword, from: email, to: config.to ?? email }, content, files);
    }
    if (!config.email || !config.refreshToken) return { ok: false, detail: NOT_CONNECTED };
    const cached = config.accessToken && (config.accessTokenExpiresAt ?? 0) > Date.now() + EXPIRY_MARGIN_MS ? config.accessToken : null;
    const token = cached ?? (await refreshAccessToken(ctx, config.refreshToken));
    if (typeof token !== "string") return token;
    const raw = utf8(buildMime(config.email, config.to ?? config.email, content, files));
    let response = await postRaw(token, raw, files.length > 0);
    if (response.status === 401 && cached) {
      const fresh = await refreshAccessToken(ctx, config.refreshToken);
      if (typeof fresh !== "string") return fresh;
      response = await postRaw(fresh, raw, files.length > 0);
    }
    if (!response.ok) return { ok: false, detail: `Gmail ${response.status}: ${errorText(response)}` };
    const id = isRecord(response.json) && typeof response.json.id === "string" ? response.json.id : undefined;
    return { ok: true, providerId: id };
  },
};

async function refreshAccessToken(ctx: SendContext<"gmail">, refreshToken: string): Promise<string | SendResult> {
  const response = await http(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: ctx.env.GOOGLE_CLIENT_ID,
      client_secret: ctx.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
    }).toString(),
  });
  const json = response.json;
  if (isRecord(json) && json.error === "invalid_grant") return { ok: false, detail: REVOKED };
  if (!response.ok || !isRecord(json) || typeof json.access_token !== "string") {
    return { ok: false, detail: `Google token refresh failed: ${errorText(response)}` };
  }
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
  await ctx.saveConfig({ accessToken: json.access_token, accessTokenExpiresAt: Date.now() + expiresIn * 1000 });
  return json.access_token;
}

/** Messages with files go through media upload, which takes the raw message, so files are base64 encoded once. */
function postRaw(token: string, raw: Uint8Array, withFiles: boolean): Promise<HttpResponse> {
  if (!withFiles) {
    return http(SEND_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: base64(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") }),
    });
  }
  return http(UPLOAD_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "message/rfc822" },
    body: raw,
    timeoutMs: 30_000,
  });
}

/** multipart/mixed with a text and HTML alternative, then one part per file. */
export function buildMime(from: string, to: string, content: EmailContent, files: PlannedFile[] = []): string {
  const mixed = `beep-me-mixed-${crypto.randomUUID()}`;
  const alternative = `beep-me-alt-${crypto.randomUUID()}`;
  const domain = from.split("@").pop() || "beep-me.local";
  const text = (type: string, body: string) =>
    [`--${alternative}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap(base64(utf8(body)))].join("\r\n");
  const attachments = files.flatMap(({ attachment, bytes }) => {
    if (!bytes) return [];
    const name = attachment.name.replace(/["\r\n\\]/g, "");
    return [
      [
        `--${mixed}`,
        `Content-Type: ${attachment.mime}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrap(base64(bytes)),
      ].join("\r\n"),
    ];
  });
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(content.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alternative}"`,
    "",
    text("text/plain", content.text),
    text("text/html", content.html),
    `--${alternative}--`,
    ...attachments,
    `--${mixed}--`,
    "",
  ].join("\r\n");
}

function wrap(text: string): string {
  return text.match(/.{1,76}/g)?.join("\r\n") ?? "";
}
