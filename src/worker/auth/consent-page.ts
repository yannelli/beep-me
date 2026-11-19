import type { ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import { PRIORITIES, PRIORITY_INFO } from "../../shared/priority";
import type { Agent } from "../db/agents";
import type { StoredChannel } from "../db/channels";
import type { User } from "../db/users";

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const STYLE = `
:root{color-scheme:dark light;--bg:#0b0b10;--card:#14141c;--line:#262633;--text:#ececf3;--muted:#9a9aae;--accent:#8b5cf6;--accent-ink:#fff;--warn:#f59e0b}
@media (prefers-color-scheme:light){:root{--bg:#f6f6f9;--card:#fff;--line:#e3e3ea;--text:#16161d;--muted:#5f5f70}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:460px;margin:0 auto;padding:max(24px,env(safe-area-inset-top)) 18px 32px}
.brand{display:flex;align-items:center;gap:10px;font-weight:650;letter-spacing:-.01em;margin-bottom:22px}
.logo{width:30px;height:30px;border-radius:9px;background:var(--accent);display:grid;place-items:center;color:var(--accent-ink);font-weight:800}
h1{font-size:22px;line-height:1.25;letter-spacing:-.02em;margin:0 0 6px}p{margin:0 0 10px;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px;margin:14px 0}
.label{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px}
.warn{border-color:color-mix(in srgb,var(--warn) 50%,var(--line));color:var(--text)}
input[type=text]{width:100%;font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:11px 12px}
.seg{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.seg label{position:relative}
.seg input{position:absolute;opacity:0}.seg span{display:block;text-align:center;padding:10px 4px;border:1px solid var(--line);border-radius:10px;cursor:pointer;font-weight:550}
.seg input:checked+span{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 16%,transparent)}
.seg input:focus-visible+span,.row input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer}.row input{margin-top:4px;accent-color:var(--accent)}
.hint{font-size:13px;color:var(--muted)}.list{padding-left:26px;display:none}
form:has(#scope-custom:checked) .list{display:block}
.actions{display:flex;gap:10px;margin-top:18px}button{flex:1;font:inherit;font-weight:650;border-radius:12px;padding:13px;border:1px solid var(--line);cursor:pointer;background:var(--card);color:var(--text)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
`;

export interface ConsentView {
  details: ConsentDescription;
  handle: string;
  user: User;
  agents: Agent[];
  channels: StoredChannel[];
}

function priorityControl(): string {
  return PRIORITIES.map(
    (priority) =>
      `<label><input type="radio" name="max_priority" value="${priority}"${priority === "high" ? " checked" : ""}><span>${PRIORITY_INFO[priority].label}</span></label>`,
  ).join("");
}

function agentChoice(agents: Agent[]): string {
  if (!agents.length) return `<input type="hidden" name="agent" value="new">`;
  const existing = agents
    .map(
      (agent, index) =>
        `<label class="row"><input type="radio" name="agent" value="${escapeHtml(agent.id)}"${index === 0 ? " checked" : ""}><span>Reconnect <strong>${escapeHtml(agent.name)}</strong><br><span class="hint">Beep Me keeps its history and limits.</span></span></label>`,
    )
    .join("");
  return `<div class="card"><p class="label">Connect as</p>${existing}<label class="row"><input type="radio" name="agent" value="new"><span>A new agent</span></label></div>`;
}

function channelChoice(channels: StoredChannel[]): string {
  const list = channels
    .map(
      (channel) =>
        `<label class="row"><input type="checkbox" name="channel" value="${escapeHtml(channel.id)}" checked><span>${escapeHtml(channel.name)} <span class="hint">${escapeHtml(CHANNEL_CATALOG[channel.kind].name)}</span></span></label>`,
    )
    .join("");
  return `<div class="card"><p class="label">Channels it can use</p>
<label class="row"><input type="radio" name="scope" value="all" checked><span>Every channel, including ones you add later</span></label>
${channels.length ? `<label class="row"><input id="scope-custom" type="radio" name="scope" value="custom"><span>Only the channels I pick</span></label><div class="list">${list}</div>` : ""}
</div>`;
}

export function renderConsentPage(view: ConsentView): string {
  const { details, handle, user, agents, channels } = view;
  const client = escapeHtml(details.clientName || "An MCP client");
  const publisher = details.clientDomain
    ? `Published by <strong>${escapeHtml(details.clientDomain)}</strong>.`
    : "This app registered itself, so Beep Me cannot confirm its name.";
  const loopback = details.redirectIsLoopback
    ? `<div class="card warn">This sends access to an app on your computer. If you did not start this from that app just now, select Deny.</div>`
    : "";
  const defaultName = agents[0]?.name ?? details.clientName ?? "My agent";
  const quiet = user.settings.quietHours;
  const breakthrough = !quiet.enabled ? "" : quiet.breakthrough === "urgent" ? " Only Urgent breaks through your quiet hours." : " High and Urgent break through your quiet hours.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Connect ${client} to Beep Me</title><style>${STYLE}</style></head><body><main>
<div class="brand"><div class="logo"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M22 8c0-2.3-.8-4.3-2-6"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/></svg></div>Beep Me</div>
<h1>Let ${client} send you notifications?</h1>
<p>${publisher} Access goes to <strong>${escapeHtml(details.redirectHost)}</strong>. You are signed in as ${escapeHtml(user.email)}.</p>
${loopback}
<form method="post" action="/authorize">
<input type="hidden" name="handle" value="${escapeHtml(handle)}">
${agentChoice(agents)}
<div class="card"><p class="label">Agent name</p><input type="text" name="name" maxlength="60" required value="${escapeHtml(defaultName)}">
<p class="hint" style="margin-top:8px">Every message shows this name.</p></div>
<div class="card"><p class="label">Highest priority</p><div class="seg">${priorityControl()}</div>
<p class="hint" style="margin-top:8px">Beep Me lowers higher requests to this level.${breakthrough}</p></div>
${channelChoice(channels)}
<p class="hint">You can change these limits or revoke access at any time in Beep Me.</p>
<div class="actions"><button type="submit" name="decision" value="deny">Deny</button><button class="primary" type="submit" name="decision" value="approve">Allow</button></div>
</form></main></body></html>`;
}

export function renderMessagePage(title: string, message: string, status = 400): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Beep Me</title><style>${STYLE}</style></head><body><main><div class="brand"><div class="logo"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.268 21a2 2 0 0 0 3.464 0"/><path d="M22 8c0-2.3-.8-4.3-2-6"/><path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/></svg></div>Beep Me</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a style="color:var(--accent)" href="/">Open Beep Me</a></p></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
