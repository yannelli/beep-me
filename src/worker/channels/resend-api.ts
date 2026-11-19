import type { ChannelConfig } from "../../shared/channel-configs";
import { sha256Hex } from "../lib/crypto";
import { http, type HttpInit, type HttpResponse } from "./http";

const RESEND_API = "https://api.resend.com";
export const USER_AGENT = "BeepMe/0.1";
/** Resend allows 40 MB per email after base64 encoding, which adds a third. */
export const RESEND_ATTACHMENT_BUDGET = 28 * 1024 * 1024;

type ResendAuth = Pick<ChannelConfig<"resend">, "apiKey" | "apiBase">;

export function resendRequest(config: ResendAuth, path: string, init: Omit<HttpInit, "headers"> & { headers?: Record<string, string> } = {}): Promise<HttpResponse> {
  return http(`${config.apiBase ?? RESEND_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "user-agent": USER_AGENT,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

/** Stable lowercase id for an agent's address. Mail servers can change the case of the local part. */
export async function agentTag(agentId: string): Promise<string> {
  return (await sha256Hex(`beep-me-agent:${agentId}`)).slice(0, 10);
}

export function agentSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  return slug || "agent";
}

/** "claude-code+1a2b3c4d5e@agents.example.com". Replies find the agent by the part after the plus. */
export async function agentAddress(agent: { id: string; name: string }, domain: string): Promise<string> {
  return `${agentSlug(agent.name)}+${await agentTag(agent.id)}@${domain}`;
}

export function tagFromAddress(address: string, domain: string): string | null {
  const match = /^[^@+]*\+([0-9a-f]{10})@(.+)$/i.exec(address.trim());
  return match && match[2].toLowerCase() === domain ? match[1].toLowerCase() : null;
}

export function displayName(name: string, address: string): string {
  const clean = name.replace(/[\r\n"\\<>]/g, "").trim().slice(0, 80);
  return clean ? `"${clean}" <${address}>` : address;
}

/** Message-ID and a References anchor both carry the Beep Me message id, so a reply matches even if Resend replaces the Message-ID. */
export function threadHeaders(messageId: string, domain: string): Record<string, string> {
  return { "Message-ID": `<${messageId}@${domain}>`, References: `<${messageId}.thread@${domain}>` };
}

/** Beep Me message ids in a reply's threading headers, nearest parent first. */
export function messageIdsIn(inReplyTo: string | undefined, references: string | undefined): string[] {
  const pattern = /msg_[0-9A-Za-z]{16}/g;
  return [...new Set([...(inReplyTo?.match(pattern) ?? []), ...(references?.match(pattern) ?? []).reverse()])];
}

export function emailDomain(address: string): string | null {
  return /@([^@>\s]+)>?\s*$/.exec(address)?.[1]?.toLowerCase() ?? null;
}

export function restrictedKeyText(response: HttpResponse): string | null {
  const json = response.json as { name?: string } | null;
  return response.status === 401 && json?.name === "restricted_api_key"
    ? "This Resend API key can only send. Create a full access key in Resend and paste it in API key."
    : null;
}
