import { errorText, http, isRecord, type HttpResponse } from "./http";
import { base64, encodeSubject, renderEmail, utf8, type EmailContent } from "./render-email";
import { sendSmtp } from "./smtp";
import type { ChannelAdapter, SendContext, SendResult } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const REVOKED = "Google access was revoked. Connect Gmail again.";
const NOT_CONNECTED = "Gmail is not connected yet. Connect Gmail to send email.";
const EXPIRY_MARGIN_MS = 60_000;

export const gmail: ChannelAdapter<"gmail"> = {
  kind: "gmail",

  async send(ctx, message) {
    const config = ctx.config;
    const content = renderEmail(message);
    if (config.mode === "app_password") {
      const { email, appPassword } = config;
      return sendSmtp({ host: "smtp.gmail.com", port: 465, security: "tls", username: email, password: appPassword, from: email, to: config.to ?? email }, content);
    }
    if (!config.email || !config.refreshToken) return { ok: false, detail: NOT_CONNECTED };
    const cached = config.accessToken && (config.accessTokenExpiresAt ?? 0) > Date.now() + EXPIRY_MARGIN_MS ? config.accessToken : null;
    const token = cached ?? (await refreshAccessToken(ctx, config.refreshToken));
    if (typeof token !== "string") return token;
    const raw = base64Url(utf8(buildMime(config.email, config.to ?? config.email, content)));
    let response = await postRaw(token, raw);
    if (response.status === 401 && cached) {
      const fresh = await refreshAccessToken(ctx, config.refreshToken);
      if (typeof fresh !== "string") return fresh;
      response = await postRaw(fresh, raw);
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

function postRaw(token: string, raw: string): Promise<HttpResponse> {
  return http(SEND_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
}

export function buildMime(from: string, to: string, content: EmailContent): string {
  const boundary = `beep-me-${crypto.randomUUID()}`;
  const domain = from.split("@").pop() || "beep-me.local";
  const part = (type: string, body: string) =>
    [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", wrap(base64(utf8(body)))].join("\r\n");
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(content.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    part("text/plain", content.text),
    part("text/html", content.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function wrap(text: string): string {
  return text.match(/.{1,76}/g)?.join("\r\n") ?? "";
}
