import { Bot, ChevronRight, Plus } from "lucide-react";
import type { AgentDTO, ChannelDTO } from "../../shared/api";
import { Avatar, Badge, Button, EmptyState, ErrorBox, PageHeader, PriorityChip, SkeletonList, type Tone } from "../components/ui";
import { copy } from "../copy";
import { errorMessage } from "../lib/api";
import { relativeTime, untilTime } from "../lib/format";
import { useQuery } from "../lib/query";
import { Link, navigate, useLocation } from "../lib/router";
import { ConnectAgentSheet } from "./agents/ConnectAgentSheet";
import { scopeLabel } from "./agents/ChannelScope";

export function agentStatus(agent: AgentDTO): { label: string; tone: Tone } {
  if (agent.status === "revoked") return { label: "Revoked", tone: "error" };
  if (agent.mutedUntil && agent.mutedUntil > Date.now()) return { label: `Muted until ${untilTime(agent.mutedUntil)}`, tone: "warn" };
  return { label: "Active", tone: "ok" };
}

function AgentRow({ agent, channels }: { agent: AgentDTO; channels: ChannelDTO[] | undefined }) {
  const status = agentStatus(agent);
  return (
    <li>
      <Link href={`/agents/${agent.id}`} className={`flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-muted/50 ${agent.status === "revoked" ? "opacity-60" : ""}`}>
        <Avatar name={agent.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{agent.name}</span>
          <span className="block text-sm text-muted">
            {agent.clientName ?? "Token"} · seen {relativeTime(agent.lastSeenAt)} · {agent.sent24h} in 24h
          </span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <PriorityChip priority={agent.maxPriority} />
            <Badge>{scopeLabel(agent.channelIds, channels)}</Badge>
            {status.tone !== "ok" && <Badge tone={status.tone}>{status.label}</Badge>}
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

export function Agents() {
  const agents = useQuery<{ items: AgentDTO[] }>("/api/agents");
  const channels = useQuery<{ items: ChannelDTO[] }>("/api/channels");
  const { search } = useLocation();
  const connecting = search.get("connect") === "1";
  const open = () => navigate("/agents?connect=1", { replace: true });
  const close = () => navigate("/agents", { replace: true });
  const items = agents.data?.items ?? [];
  const sorted = [...items.filter((agent) => agent.status === "active"), ...items.filter((agent) => agent.status !== "active")];

  return (
    <>
      <PageHeader
        title={copy.nav.agents}
        subtitle={copy.agents.subtitle}
        action={
          items.length > 0 && (
            <Button variant="primary" small onClick={open}>
              <Plus className="size-4" aria-hidden />
              Connect
            </Button>
          )
        }
      />
      {Boolean(agents.error) && !agents.data && <ErrorBox error={errorMessage(agents.error)} onRetry={() => void agents.refetch()} />}
      {!agents.data && !agents.error && <SkeletonList rows={3} />}
      {agents.data && items.length === 0 && (
        <EmptyState
          icon={<Bot className="size-6" aria-hidden />}
          title={copy.agents.emptyTitle}
          body={copy.agents.emptyBody}
          action={
            <Button variant="primary" onClick={open}>
              <Plus className="size-4" aria-hidden />
              Connect an agent
            </Button>
          }
        />
      )}
      {sorted.length > 0 && (
        <ul className="space-y-2">
          {sorted.map((agent) => (
            <AgentRow key={agent.id} agent={agent} channels={channels.data?.items} />
          ))}
        </ul>
      )}
      <ConnectAgentSheet open={connecting} onClose={close} />
    </>
  );
}
