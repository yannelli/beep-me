import { Hono, type Context } from "hono";
import type { ChannelConfig } from "../../shared/channel-configs";
import { RESEND_REGIONS, type ResendDomainDetail, type ResendDomainSummary, type ResendPreview, type ResendSetupState } from "../../shared/resend";
import { notFound, readJson } from "../api/util";
import type { AppEnv } from "../auth/session";
import { errorText, isRecord, type HttpResponse } from "../channels/http";
import { resendRequest, restrictedKeyText } from "../channels/resend-api";
import { getChannel, saveChannelConfig, type StoredChannel } from "../db/channels";
import { fullName, lookupZone, zoneFile } from "./resend-dns";

/** Dashboard API for Resend domains and inbound email setup. Mounted at /api/integrations/resend. */
export const resendIntegration = new Hono<AppEnv>();

type Ctx = Context<AppEnv>;
type ResendChannel = StoredChannel & { config: ChannelConfig<"resend"> };

async function loadChannel(c: Ctx): Promise<ResendChannel | null> {
  const channel = await getChannel(c.env, c.get("user").id, c.req.param("channelId") ?? "");
  return channel?.kind === "resend" ? (channel as ResendChannel) : null;
}

function upstreamError(c: Ctx, response: HttpResponse) {
  return c.json({ error: restrictedKeyText(response) ?? `Resend ${response.status}: ${errorText(response)}` }, 502);
}

/** Answers 409 with what the change would do, unless the body has confirm: true. */
async function needsConfirm(c: Ctx, preview: ResendPreview["preview"]): Promise<Response | null> {
  if ((await readJson(c)).confirm === true) return null;
  return c.json<ResendPreview>({ error: "Confirm this change first.", preview }, 409);
}

function webhookUrl(c: Ctx, channel: ResendChannel): string | null {
  const origin = c.get("origin");
  return origin.startsWith("https://") || channel.config.apiBase ? `${origin}/hooks/resend/${channel.id}` : null;
}

function toSummary(value: Record<string, unknown>): ResendDomainSummary {
  const capabilities = isRecord(value.capabilities) ? value.capabilities : {};
  return {
    id: String(value.id),
    name: String(value.name),
    status: String(value.status ?? "not_started"),
    region: typeof value.region === "string" ? value.region : null,
    sending: capabilities.sending !== "disabled",
    receiving: capabilities.receiving === "enabled",
  };
}

async function domainDetail(channel: ResendChannel, domainId: string): Promise<ResendDomainDetail | HttpResponse> {
  const response = await resendRequest(channel.config, `/domains/${encodeURIComponent(domainId)}`);
  if (!response.ok || !isRecord(response.json)) return response;
  const summary = toSummary(response.json);
  const dns = await lookupZone(summary.name);
  const records = (Array.isArray(response.json.records) ? response.json.records : []).filter(isRecord).map((record) => ({
    record: String(record.record ?? ""),
    type: String(record.type ?? ""),
    name: String(record.name ?? ""),
    fqdn: fullName(String(record.name ?? ""), summary.name, dns.zone),
    value: String(record.value ?? ""),
    ttl: String(record.ttl ?? "Auto"),
    priority: typeof record.priority === "number" ? record.priority : null,
    status: String(record.status ?? "not_started"),
  }));
  return { ...summary, records, dns, zoneFile: zoneFile(records) };
}

function isDetail(value: ResendDomainDetail | HttpResponse): value is ResendDomainDetail {
  return "records" in value;
}

resendIntegration.get("/:channelId", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const url = webhookUrl(c, channel);
  const state: ResendSetupState = { domain: channel.config.domain ?? null, webhookUrl: url, webhook: null, secretSet: Boolean(channel.config.webhookSecret), keyError: null };
  const response = await resendRequest(channel.config, "/webhooks");
  if (!response.ok) return c.json({ ...state, keyError: restrictedKeyText(response) ?? `Resend ${response.status}: ${errorText(response)}` });
  const list = isRecord(response.json) && Array.isArray(response.json.data) ? response.json.data.filter(isRecord) : [];
  const found = list.find((hook) => hook.endpoint === url || hook.id === channel.config.webhookId);
  if (found) state.webhook = { id: String(found.id), status: String(found.status ?? ""), events: Array.isArray(found.events) ? found.events.map(String) : [] };
  return c.json(state);
});

resendIntegration.get("/:channelId/domains", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const response = await resendRequest(channel.config, "/domains");
  if (!response.ok) return upstreamError(c, response);
  const list = isRecord(response.json) && Array.isArray(response.json.data) ? response.json.data.filter(isRecord) : [];
  return c.json({ items: list.map(toSummary) });
});

resendIntegration.get("/:channelId/domains/:domainId", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const detail = await domainDetail(channel, c.req.param("domainId"));
  return isDetail(detail) ? c.json(detail) : upstreamError(c, detail);
});

resendIntegration.post("/:channelId/domains", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const input = await readJson(c);
  const name = String(input.name ?? "").trim().toLowerCase();
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(name)) return c.json({ error: "Enter a domain, like agents.example.com.", fields: { name: "Enter a domain." } }, 400);
  const region = RESEND_REGIONS.find((value) => value === input.region) ?? "us-east-1";
  const body = { name, region, capabilities: { sending: "enabled", receiving: "enabled" } };
  const blocked = await needsConfirm(c, { method: "POST", path: "/domains", body, summary: `Add ${name} to Resend in ${region}, with sending and receiving on.` });
  if (blocked) return blocked;
  const response = await resendRequest(channel.config, "/domains", { method: "POST", body: JSON.stringify(body) });
  if (!response.ok || !isRecord(response.json)) return upstreamError(c, response);
  const detail = await domainDetail(channel, String(response.json.id));
  return isDetail(detail) ? c.json(detail) : upstreamError(c, detail);
});

resendIntegration.post("/:channelId/domains/:domainId/receiving", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const domainId = c.req.param("domainId");
  const body = { capabilities: { receiving: "enabled" } };
  const blocked = await needsConfirm(c, { method: "PATCH", path: `/domains/${domainId}`, body, summary: "Turn on receiving for this domain. Resend adds an MX record to set up." });
  if (blocked) return blocked;
  const response = await resendRequest(channel.config, `/domains/${encodeURIComponent(domainId)}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!response.ok) return upstreamError(c, response);
  const detail = await domainDetail(channel, domainId);
  return isDetail(detail) ? c.json(detail) : upstreamError(c, detail);
});

resendIntegration.post("/:channelId/domains/:domainId/verify", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const domainId = c.req.param("domainId");
  const blocked = await needsConfirm(c, { method: "POST", path: `/domains/${domainId}/verify`, summary: "Ask Resend to check the DNS records again." });
  if (blocked) return blocked;
  const response = await resendRequest(channel.config, `/domains/${encodeURIComponent(domainId)}/verify`, { method: "POST" });
  if (!response.ok) return upstreamError(c, response);
  const detail = await domainDetail(channel, domainId);
  return isDetail(detail) ? c.json(detail) : upstreamError(c, detail);
});

resendIntegration.post("/:channelId/domains/:domainId/use", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const detail = await domainDetail(channel, c.req.param("domainId"));
  if (!isDetail(detail)) return upstreamError(c, detail);
  const blocked = await needsConfirm(c, { method: "PATCH", path: `/api/channels/${channel.id}`, body: { domain: detail.name }, summary: `Send each agent's email from its own address on ${detail.name}.` });
  if (blocked) return blocked;
  await saveChannelConfig(c.env, channel.id, { ...channel.config, domain: detail.name });
  return c.json(detail);
});

resendIntegration.post("/:channelId/webhook", async (c) => {
  const channel = await loadChannel(c);
  if (!channel) return notFound(c, "Channel not found");
  const url = webhookUrl(c, channel);
  if (!url) return c.json({ error: "Resend needs a public https URL for replies. Deploy Beep Me, then create the webhook from the deployed dashboard." }, 400);
  const list = await resendRequest(channel.config, "/webhooks");
  if (!list.ok) return upstreamError(c, list);
  const existing = (isRecord(list.json) && Array.isArray(list.json.data) ? list.json.data.filter(isRecord) : []).find((hook) => hook.endpoint === url);
  const body = { endpoint: url, events: ["email.received"] };
  const blocked = await needsConfirm(
    c,
    existing
      ? { method: "GET", path: `/webhooks/${String(existing.id)}`, summary: "Use the Resend webhook that already points at this channel, and save its signing secret." }
      : { method: "POST", path: "/webhooks", body, summary: `Create a Resend webhook that sends email.received events to ${url}.` },
  );
  if (blocked) return blocked;
  const response = existing
    ? await resendRequest(channel.config, `/webhooks/${encodeURIComponent(String(existing.id))}`)
    : await resendRequest(channel.config, "/webhooks", { method: "POST", body: JSON.stringify(body) });
  const secret = isRecord(response.json) ? response.json.signing_secret : undefined;
  if (!response.ok || !isRecord(response.json) || typeof secret !== "string") return upstreamError(c, response);
  await saveChannelConfig(c.env, channel.id, { ...channel.config, webhookSecret: secret, webhookId: String(response.json.id) });
  return c.json({ ok: true, webhookId: String(response.json.id) });
});
