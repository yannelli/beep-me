import { connect } from "cloudflare:sockets";
import { LogLevel, WorkerMailer, type User } from "worker-mailer";
import { clip } from "./http";
import { encodeSubject, renderEmail, type EmailContent } from "./render-email";
import type { ChannelAdapter, SendResult } from "./types";

export interface SmtpOptions {
  host: string;
  port: number;
  /** "tls" is implicit TLS (465). "starttls" upgrades a plain connection (587). */
  security: "tls" | "starttls";
  username: string;
  password: string;
  from: string;
  to: string;
  headers?: Record<string, string>;
}

const TIMEOUT_MS = 10_000;

/** worker-mailer falls back to plaintext AUTH when STARTTLS is missing, so check the server's EHLO first. */
async function serverOffersStartTls(host: string, port: number): Promise<boolean> {
  const socket = connect({ hostname: host, port }, { secureTransport: "starttls", allowHalfOpen: false });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  const readReply = async () => {
    let text = "";
    while (!/^\d{3} [^\n]*\r?\n?$/m.test(text.split(/\r?\n/).filter(Boolean).at(-1) ?? "")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text;
  };
  const deadline = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("SMTP server did not answer")), TIMEOUT_MS));
  try {
    return await Promise.race([
      (async () => {
        await readReply();
        await writer.write(new TextEncoder().encode("EHLO beep-me.local\r\n"));
        const ehlo = await readReply();
        await writer.write(new TextEncoder().encode("QUIT\r\n")).catch(() => undefined);
        return /[ -]STARTTLS\b/i.test(ehlo);
      })(),
      deadline,
    ]);
  } finally {
    await socket.close().catch(() => undefined);
  }
}

export async function sendSmtp(options: SmtpOptions, content: EmailContent): Promise<SendResult> {
  let mailer: WorkerMailer | null = null;
  try {
    if (options.security === "starttls" && !(await serverOffersStartTls(options.host, options.port))) {
      return { ok: false, detail: `${options.host} does not offer STARTTLS. Beep Me did not send your password. Use SSL/TLS on port 465.` };
    }
    mailer = await WorkerMailer.connect({
      host: options.host,
      port: options.port,
      secure: options.security === "tls",
      startTls: options.security === "starttls",
      credentials: { username: options.username, password: options.password },
      authType: ["plain", "login", "cram-md5"],
      logLevel: LogLevel.NONE,
      socketTimeoutMs: TIMEOUT_MS,
      responseTimeoutMs: TIMEOUT_MS,
    });
    await mailer.send({
      from: parseAddress(options.from),
      to: parseAddress(options.to),
      subject: content.subject,
      text: content.text,
      html: content.html,
      headers: { ...options.headers, Subject: encodeSubject(content.subject) },
    });
    return { ok: true, detail: `Accepted by ${options.host}` };
  } catch (error) {
    return { ok: false, detail: smtpError(error, options) };
  } finally {
    await mailer?.close().catch(() => undefined);
  }
}

/** Accepts "Name <user@example.com>" or a bare address. */
export function parseAddress(value: string): User {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (!match) return { email: value.trim() };
  const name = match[1].trim();
  return name ? { name, email: match[2].trim() } : { email: match[2].trim() };
}

function smtpError(error: unknown, options: SmtpOptions): string {
  const message = error instanceof Error ? error.message : String(error);
  return clip(message.split(options.password).join("***").replace(/\s+/g, " ").trim() || "SMTP send failed");
}

export const smtp: ChannelAdapter<"smtp"> = {
  kind: "smtp",
  send(ctx, message) {
    const { host, port, security, username, password, from, to } = ctx.config;
    return sendSmtp({ host, port, security, username, password, from, to }, renderEmail(message));
  },
};
