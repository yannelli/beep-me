import { ArrowLeft, BellOff, RotateCw, ShieldOff, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { AgentDTO, MeResponse, UpdateAgentBody } from "../../shared/api";
import { TextField } from "../components/form";
import { PriorityPicker } from "../components/PriorityPicker";
import { ConfirmSheet, Sheet } from "../components/Sheet";
import { Avatar, Badge, Button, Card, ErrorBox, Skeleton } from "../components/ui";
import { copy } from "../copy";
import { api, errorMessage, fieldErrors } from "../lib/api";
import { dateTime, relativeTime } from "../lib/format";
import { fetchQuery, setQueryData, useQuery } from "../lib/query";
import { Link, navigate } from "../lib/router";
import { useToast } from "../lib/toast";
import { agentStatus } from "./Agents";
import { ChannelScope } from "./agents/ChannelScope";
import { TokenReveal } from "./agents/TokenAgent";

type Confirm = "revoke" | "rotate" | "delete" | null;
const hour = 3_600_000;

function numberOrNull(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

function Detail({ agent, me }: { agent: AgentDTO; me: MeResponse | undefined }) {
  const toast = useToast();
  const status = agentStatus(agent);
  const [name, setName] = useState(agent.name);
  const [sms, setSms] = useState(agent.smsPerHour?.toString() ?? "");
  const [messages, setMessages] = useState(agent.messagesPerHour?.toString() ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [token, setToken] = useState<string | null>(null);
  const active = agent.status === "active";
  const muted = Boolean(agent.mutedUntil && agent.mutedUntil > Date.now());
  const dirty = name !== agent.name || numberOrNull(sms) !== agent.smsPerHour || numberOrNull(messages) !== agent.messagesPerHour;

  function store(updated: AgentDTO) {
    setQueryData<{ items: AgentDTO[] }>("/api/agents", (list) => ({ items: (list?.items ?? []).map((item) => (item.id === updated.id ? updated : item)) }));
  }

  async function run<T>(label: string, task: () => Promise<T>, done?: (result: T) => void) {
    setBusy(label);
    try {
      done?.(await task());
    } catch (error) {
      setErrors(fieldErrors(error));
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  const patch = (label: string, body: UpdateAgentBody, message?: string) =>
    run(label, () => api.patch<AgentDTO>(`/api/agents/${agent.id}`, body), (updated) => {
      store(updated);
      if (message) toast(message);
    });

  function saveDetails(event: FormEvent) {
    event.preventDefault();
    setErrors({});
    void patch("details", { name: name.trim(), smsPerHour: numberOrNull(sms), messagesPerHour: numberOrNull(messages) }, "Saved.");
  }

  const mutes = [
    { label: "1 hour", ms: hour },
    { label: "8 hours", ms: 8 * hour },
    { label: "24 hours", ms: 24 * hour },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Avatar name={agent.name} size={48} />
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-2xl font-bold tracking-tight break-words">{agent.name}</h1>
          <p className="text-sm text-muted">
            {agent.clientName ?? `Token …${agent.tokenHint ?? ""}`} · seen {relativeTime(agent.lastSeenAt)} · {agent.sent24h} in 24h
          </p>
        </div>
      </header>
      {status.tone !== "ok" && <Badge tone={status.tone}>{status.label}</Badge>}

      {active && (
        <>
          <Card title="Details">
            <form onSubmit={saveDetails} className="space-y-4" noValidate>
              <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} autoComplete="off" />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Texts per hour" type="number" inputMode="numeric" min={0} placeholder={`${me?.settings.limits.smsPerHour ?? ""} (default)`} value={sms} onChange={(event) => setSms(event.target.value)} error={errors.smsPerHour} />
                <TextField label="Messages per hour" type="number" inputMode="numeric" min={1} placeholder={`${me?.settings.limits.messagesPerHour ?? ""} (default)`} value={messages} onChange={(event) => setMessages(event.target.value)} error={errors.messagesPerHour} />
              </div>
              <Button type="submit" variant="primary" disabled={!dirty || !name.trim()} busy={busy === "details"}>
                Save changes
              </Button>
            </form>
          </Card>

          <Card title="Highest priority">
            <p className="mb-3 text-sm text-muted">Beep Me lowers anything above this.</p>
            <PriorityPicker label="Highest priority" value={agent.maxPriority} onChange={(maxPriority) => void patch("priority", { maxPriority })} />
          </Card>

          <Card title="Channels">
            <ChannelScope value={agent.channelIds} onChange={(channelIds) => void patch("channels", { channelIds })} />
          </Card>

          <Card title="Mute">
            <p className="mb-3 text-sm text-muted">{muted ? "Beep Me records messages from this agent but does not deliver them." : "Stop delivery from this agent for a while."}</p>
            <div className="flex flex-wrap gap-2">
              {mutes.map((mute) => (
                <Button key={mute.label} small busy={busy === mute.label} onClick={() => void patch(mute.label, { mutedUntil: Date.now() + mute.ms }, `Muted for ${mute.label}.`)}>
                  <BellOff className="size-4" aria-hidden />
                  {mute.label}
                </Button>
              ))}
              {muted && (
                <Button small variant="primary" busy={busy === "unmute"} onClick={() => void patch("unmute", { mutedUntil: null }, "Unmuted.")}>
                  Unmute
                </Button>
              )}
            </div>
          </Card>
        </>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <p className="text-sm text-muted">
          Added {dateTime(agent.createdAt)}
          {agent.revokedAt && ` · revoked ${dateTime(agent.revokedAt)}`}
        </p>
        <div className="flex flex-wrap gap-2">
          {active && agent.kind === "token" && (
            <Button onClick={() => setConfirm("rotate")}>
              <RotateCw className="size-4" aria-hidden />
              Rotate token
            </Button>
          )}
          {active && (
            <Button variant="danger" onClick={() => setConfirm("revoke")}>
              <ShieldOff className="size-4" aria-hidden />
              Revoke access
            </Button>
          )}
          {!active && (
            <Button variant="danger" onClick={() => setConfirm("delete")}>
              <Trash2 className="size-4" aria-hidden />
              Delete agent
            </Button>
          )}
        </div>
      </div>

      <ConfirmSheet
        open={confirm === "revoke"}
        onClose={() => setConfirm(null)}
        title={`Revoke ${agent.name}?`}
        body={copy.agents.revokeBody}
        confirmLabel="Revoke access"
        busy={busy === "revoke"}
        onConfirm={() =>
          void run("revoke", () => api.post<AgentDTO>(`/api/agents/${agent.id}/revoke`), (updated) => {
            store(updated);
            setConfirm(null);
            toast(`${agent.name} can no longer send messages.`);
          })
        }
      />
      <ConfirmSheet
        open={confirm === "rotate"}
        onClose={() => setConfirm(null)}
        title="Rotate token?"
        body={copy.agents.rotateBody}
        confirmLabel="Rotate token"
        busy={busy === "rotate"}
        onConfirm={() =>
          void run("rotate", () => api.post<{ agent: AgentDTO; token: string }>(`/api/agents/${agent.id}/rotate`), (result) => {
            store(result.agent);
            setConfirm(null);
            setToken(result.token);
          })
        }
      />
      <ConfirmSheet
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        title={`Delete ${agent.name}?`}
        body={copy.agents.deleteBody}
        confirmLabel="Delete agent"
        busy={busy === "delete"}
        onConfirm={() =>
          void run("delete", () => api.del(`/api/agents/${agent.id}`), () => {
            setQueryData<{ items: AgentDTO[] }>("/api/agents", (list) => ({ items: (list?.items ?? []).filter((item) => item.id !== agent.id) }));
            void fetchQuery("/api/me");
            toast(`${agent.name} deleted.`);
            navigate("/agents");
          })
        }
      />
      <Sheet open={token !== null} onClose={() => setToken(null)} title="New token">
        {token && <TokenReveal token={token} />}
      </Sheet>
    </div>
  );
}

export function AgentDetail({ id }: { id: string }) {
  const agents = useQuery<{ items: AgentDTO[] }>("/api/agents");
  const me = useQuery<MeResponse>("/api/me");
  const agent = agents.data?.items.find((item) => item.id === id);

  return (
    <>
      <Link href="/agents" className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden />
        Agents
      </Link>
      {Boolean(agents.error) && !agents.data && <ErrorBox error={errorMessage(agents.error)} onRetry={() => void agents.refetch()} />}
      {!agents.data && !agents.error && <Skeleton className="h-64" />}
      {agents.data && !agent && <ErrorBox error="Beep Me cannot find this agent." />}
      {agent && <Detail key={agent.id} agent={agent} me={me.data} />}
    </>
  );
}
