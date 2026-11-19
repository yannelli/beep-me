// Fake API for `?demo=1` in dev. `&state=signedout|nogoogle|fresh` picks a starting state.
import type { AgentDTO, ApiError, ChannelDTO, MeResponse, MessageDTO, SessionResponse, TopicDTO } from "../../shared/api";
import type { ChannelKind } from "../../shared/channels";
import { PRIORITIES, type Priority } from "../../shared/priority";
import { ApiRequestError } from "./api";

const param = new URLSearchParams(location.search).get("state");
if (param) sessionStorage.setItem("beepme-demo-state", param);
const state = sessionStorage.getItem("beepme-demo-state") ?? "full";
const fresh = state === "fresh";
const now = Date.now();
const min = 60_000;
const hour = 60 * min;
let seq = 100;
const id = (prefix: string) => `${prefix}_${seq++}`;

const user = { id: "u_1", email: "ryan@example.com", name: "Ryan Yannelli", avatarUrl: null };
let signedIn = state !== "signedout" && state !== "nogoogle";

function channel(kind: ChannelKind, name: string, extra: Partial<ChannelDTO> = {}): ChannelDTO {
  return {
    id: `ch_${kind}`, kind, name, enabled: true, status: "ready", statusDetail: null, config: {}, secrets: {},
    targets: ["main"], telegram: null, lastUsedAt: now - 12 * min, lastError: null, createdAt: now - 9 * 24 * hour, ...extra,
  };
}

let channels: ChannelDTO[] = fresh ? [] : [
  channel("telegram", "Telegram", {
    targets: ["main", "topic"],
    secrets: { botToken: { set: true, hint: "x9Qa" } },
    telegram: { botUsername: "ryan_beepme_bot", chatLinked: true, chatTitle: "Ryan", topicsMode: "private", topicsChatTitle: null },
  }),
  channel("twilio", "Phone (SMS)", {
    config: { accountSid: "AC-demo-account", from: "+15550142020", to: "+15550199876" },
    secrets: { authToken: { set: true, hint: "7c1e" } }, lastUsedAt: now - 3 * hour,
  }),
  channel("ntfy", "ntfy push", { config: { server: "https://ntfy.sh", topic: "beep-me-k3x9p2m7qa" }, secrets: { token: { set: false, hint: null } } }),
  channel("gmail", "Gmail", {
    status: "error", statusDetail: "Google revoked access. Connect again.", lastError: "invalid_grant: Token has been expired or revoked.",
    config: { mode: "oauth", email: "ryan@example.com", to: "" }, lastUsedAt: now - 2 * 24 * hour,
  }),
];

function agent(name: string, extra: Partial<AgentDTO>): AgentDTO {
  return {
    id: id("ag"), name, kind: "oauth", clientName: null, tokenHint: null, maxPriority: "high", channelIds: null, smsPerHour: null,
    messagesPerHour: null, status: "active", mutedUntil: null, lastSeenAt: now - 4 * min, lastUserAgent: null,
    createdAt: now - 6 * 24 * hour, revokedAt: null, sent24h: 0, ...extra,
  };
}

let agents: AgentDTO[] = fresh ? [] : [
  agent("Claude Code on laptop", { clientName: "Claude Code", sent24h: 14, maxPriority: "urgent" }),
  agent("Claude", { clientName: "Claude", sent24h: 3, lastSeenAt: now - 2 * hour }),
  agent("GitHub Actions", { kind: "token", tokenHint: "a1F3", maxPriority: "high", channelIds: ["ch_telegram"], sent24h: 6, lastSeenAt: now - 40 * min }),
  agent("Nightly backup", { kind: "token", tokenHint: "Zq8e", maxPriority: "medium", mutedUntil: now + 5 * hour, lastSeenAt: now - 20 * hour }),
  agent("Old laptop", { clientName: "Claude Code", status: "revoked", revokedAt: now - 3 * 24 * hour, lastSeenAt: now - 4 * 24 * hour }),
];

const topics: TopicDTO[] = fresh ? [] : [
  { id: "t_deploy", key: "deploy", name: "Deploy", muted: false, messageCount: 18, lastUsedAt: now - 20 * min },
  { id: "t_ci", key: "ci", name: "CI", muted: false, messageCount: 41, lastUsedAt: now - 40 * min },
  { id: "t_billing", key: "billing", name: "Billing", muted: true, messageCount: 4, lastUsedAt: now - 2 * 24 * hour },
];

function message(i: number, agentIndex: number, priority: Priority, title: string | null, body: string, extra: Partial<MessageDTO> = {}): MessageDTO {
  const from = agents[agentIndex] ?? { id: null, name: "Beep Me" };
  return {
    id: `msg_${i}`, agentId: from.id, agentName: from.name, priority, requestedPriority: priority,
    topic: null, title, body, url: null, status: "delivered", repeatCount: 1, lastRepeatAt: null, notes: [], quiet: false,
    source: "mcp", createdAt: now - i * 23 * min,
    deliveries: [
      { id: `d_${i}`, channelId: "ch_telegram", channelKind: "telegram", channelName: "Telegram", target: "main", status: "delivered", detail: null, reason: null, updatedAt: now - i * 23 * min },
    ],
    attachments: [], options: [], expectReply: false, senderName: null, interactions: [], fallbacks: [],
    ...extra,
  };
}

const deployTopic = { key: "deploy", name: "Deploy" };
let messages: MessageDTO[] = fresh ? [] : [
  message(0, 0, "urgent", "Production deploy failed", "Migration 0042 timed out on the users table. The deploy is rolled back. I need a decision on whether to retry tonight.", {
    topic: deployTopic,
    deliveries: [
      { id: "d_a", channelId: "ch_telegram", channelKind: "telegram", channelName: "Telegram", target: "topic", status: "delivered", detail: null, reason: null, updatedAt: now },
      { id: "d_b", channelId: "ch_twilio", channelKind: "twilio", channelName: "Phone (SMS)", target: "main", status: "sent", detail: "Twilio SID SM8a1f…", reason: null, updatedAt: now },
    ],
  }),
  message(1, 2, "high", "Tests failing on main", "12 of 840 tests fail in packages/billing after the last merge.", { topic: { key: "ci", name: "CI" }, repeatCount: 3, lastRepeatAt: now - 5 * min }),
  message(2, 0, "medium", "Refactor finished", "Moved the auth helpers into src/auth and updated 31 imports. Ready for review.", {
    requestedPriority: "high", notes: ["This agent can send up to Medium, so High was lowered to Medium."],
  }),
  message(3, 1, "low", null, "Summary of today's research notes is ready in your Drive."),
  message(4, 2, "high", "Deploy to staging done", "Version 2.14.0 is live on staging.", { topic: deployTopic, status: "partial",
    deliveries: [
      { id: "d_c", channelId: "ch_telegram", channelKind: "telegram", channelName: "Telegram", target: "topic", status: "delivered", detail: null, reason: null, updatedAt: now },
      { id: "d_d", channelId: "ch_gmail", channelKind: "gmail", channelName: "Gmail", target: "main", status: "failed", detail: "invalid_grant: Token has been expired or revoked.", reason: null, updatedAt: now },
    ],
  }),
  message(5, 3, "medium", "Backup complete", "Nightly backup wrote 2.3 GB to R2.", { status: "muted", deliveries: [], notes: ["Agent is muted until 6:00 PM."] }),
  message(6, 0, "high", "Waiting for approval", "I need your OK to run the database migration on production.", { quiet: true, notes: ["Quiet hours: sent without sound."] }),
  message(7, 2, "low", "Lint warnings", "3 new lint warnings in web/.", { status: "throttled", deliveries: [], notes: ["Message cap reached for this agent."] }),
];
if (!fresh) for (let i = 8; i < 26; i++) messages.push(message(i, i % 3, PRIORITIES[i % 4]!, `Task ${i} finished`, "Routine update from a long-running job."));

const me = (): MeResponse => ({
  user, settings, mcpUrl: `${location.origin}/mcp`, notifyUrl: `${location.origin}/v1/notify`, appUrl: location.origin,
  counts: { channels: channels.length, agents: agents.length, messages: messages.length },
  quietNow: settings.quietHours.enabled, gmailOAuthAvailable: true,
});

let settings: MeResponse["settings"] = {
  timezone: "America/New_York",
  routes: fresh ? { urgent: [], high: [], medium: [], low: [] } : {
    urgent: [{ channelId: "ch_telegram", target: "topic" }, { channelId: "ch_twilio", target: "main" }],
    high: [{ channelId: "ch_telegram", target: "topic" }, { channelId: "ch_ntfy", target: "main" }],
    medium: [{ channelId: "ch_telegram", target: "topic" }],
    low: [{ channelId: "ch_telegram", target: "main" }],
  },
  fallbacks: fresh ? { urgent: [], high: [], medium: [], low: [] } : {
    urgent: [{ id: "f_1", when: "no_reply", afterMinutes: 5, destinations: [{ channelId: "ch_twilio", target: "main" }], priority: null }],
    high: [{ id: "f_2", when: "failed", afterMinutes: 0, destinations: [{ channelId: "ch_ntfy", target: "main" }], priority: null }],
    medium: [],
    low: [],
  },
  routesCustomized: false,
  rules: fresh ? [] : [
    { id: "r_1", name: "Billing goes to email", enabled: true, match: { topics: ["billing*"] }, action: { type: "route", destinations: [{ channelId: "ch_gmail", target: "main" }] } },
    { id: "r_2", name: "Mute low CI noise", enabled: false, match: { priorities: ["low"], topics: ["ci"] }, action: { type: "mute" } },
  ],
  quietHours: { enabled: true, start: "22:00", end: "07:00", days: [], breakthrough: "urgent" },
  limits: { smsPerHour: 5, messagesPerHour: 60, collapseMinutes: 10 },
  pausedUntil: null,
};

function fail(status: number, error: string, fields?: Record<string, string>): never {
  throw new ApiRequestError(status, { error, fields } satisfies ApiError);
}

function find<T extends { id: string }>(list: T[], itemId: string): T {
  return list.find((item) => item.id === itemId) ?? fail(404, "Not found.");
}

function route(method: string, path: string, body: Record<string, unknown>): unknown {
  const url = new URL(path, location.origin);
  const parts = url.pathname.split("/").filter(Boolean).slice(1);
  const [resource, itemId, action] = parts;
  if (resource === "session") {
    const setup = { googleConfigured: state !== "nogoogle", devLogin: true, googleRedirectUri: `${location.origin}/auth/google/callback` };
    return { user: signedIn ? user : null, setup } satisfies SessionResponse;
  }
  if (!signedIn) fail(401, "Sign in to continue.");
  if (resource === "me") return me();
  if (resource === "settings") {
    settings = { ...settings, ...body };
    return me();
  }
  if (resource === "pause") {
    settings.pausedUntil = body.minutes ? Date.now() + Number(body.minutes) * min : null;
    return me();
  }
  if (resource === "account") return { ok: true };
  if (resource === "channels") {
    if (!itemId) {
      if (method === "GET") return { items: channels };
      const kind = body.kind as ChannelKind;
      const created = channel(kind, String(body.name || kind), {
        id: id("ch"), config: body.config as ChannelDTO["config"], lastUsedAt: null, createdAt: Date.now(),
        status: kind === "telegram" ? "needs_setup" : "ready",
        telegram: kind === "telegram" ? { botUsername: "my_beepme_bot", chatLinked: false, chatTitle: null, topicsMode: "off", topicsChatTitle: null } : null,
      });
      channels = [...channels, created];
      return created;
    }
    const found = find(channels, itemId);
    if (method === "DELETE") return (channels = channels.filter((item) => item !== found)), { ok: true };
    if (action === "test") return { ok: found.status !== "error", detail: found.lastError ?? "Sent. Check your phone.", messageId: id("msg") };
    if (action === "telegram") {
      window.setTimeout(() => Object.assign(found, { status: "ready", telegram: { ...found.telegram, chatLinked: true, chatTitle: "Ryan" } }), 5000);
      return { url: "https://t.me/my_beepme_bot?start=demo", code: "demo", expiresAt: Date.now() + 10 * min };
    }
    if (method === "PATCH") {
      const { config, ...rest } = body as { config?: Record<string, never> };
      Object.assign(found, rest, { config: { ...found.config, ...config } });
    }
    return found;
  }
  if (resource === "agents") {
    if (!itemId) {
      if (method === "GET") return { items: agents };
      const created = agent(String(body.name), { kind: "token", tokenHint: "Ab12", maxPriority: (body.maxPriority as Priority) ?? "high", channelIds: (body.channelIds as string[] | null) ?? null, lastSeenAt: null });
      agents = [...agents, created];
      return { agent: created, token: "beep_demo_4f8a2c9e1b7d3a6f0e5c8b2a9d1f4e7c" };
    }
    const found = find(agents, itemId);
    if (method === "DELETE") return (agents = agents.filter((item) => item !== found)), { ok: true };
    if (action === "revoke") return Object.assign(found, { status: "revoked", revokedAt: Date.now() });
    if (action === "rotate") return { agent: found, token: "beep_demo_rotated_9e1b7d3a6f0e5c8b2a9d1f4e" };
    if (method === "PATCH") Object.assign(found, body);
    return found;
  }
  if (resource === "messages") {
    if (itemId === "test") {
      const sent = message(0, 0, body.priority as Priority, "Test from Beep Me", "If you can read this, Beep Me can reach you.", {
        id: id("msg"), agentId: null, agentName: "Beep Me", source: "test", createdAt: Date.now(),
      });
      messages = [sent, ...messages];
      return sent;
    }
    if (itemId) return find(messages, itemId);
    const q = url.searchParams;
    const before = Number(q.get("before") ?? Infinity);
    const filtered = messages.filter(
      (item) => item.createdAt < before && (!q.get("priority") || item.priority === q.get("priority")) &&
        (!q.get("status") || item.status === q.get("status")) && (!q.get("agent") || item.agentId === q.get("agent")),
    );
    const items = filtered.slice(0, Number(q.get("limit") ?? 20));
    return { items, nextBefore: filtered.length > items.length ? items.at(-1)!.createdAt : null };
  }
  if (resource === "topics") {
    if (!itemId) return { items: topics };
    return Object.assign(find(topics, itemId), body);
  }
  fail(404, "not found");
}

export async function demoFetch(method: string, path: string, body: unknown): Promise<unknown> {
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (path === "/auth/logout") return (signedIn = false), { ok: true };
  return structuredClone(route(method, path, (body ?? {}) as Record<string, unknown>));
}
