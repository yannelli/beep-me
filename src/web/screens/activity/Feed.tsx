import { Inbox } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentDTO, MessageDTO, MessagePage, MessageStatus } from "../../../shared/api";
import { PRIORITIES, PRIORITY_INFO, type Priority } from "../../../shared/priority";
import { ChipButton } from "../../components/form";
import { Button, EmptyState, ErrorBox, priorityDot, SkeletonList } from "../../components/ui";
import { copy } from "../../copy";
import { api, errorMessage } from "../../lib/api";
import { useInterval, useQuery } from "../../lib/query";
import { MessageRow } from "./MessageRow";
import { MESSAGE_STATUS } from "./status";

export interface Filters {
  priority: Priority | "";
  agent: string;
  status: MessageStatus | "";
}

export function feedKey(filters: Filters) {
  const params = new URLSearchParams({ limit: "30" });
  if (filters.priority) params.set("priority", filters.priority);
  if (filters.agent) params.set("agent", filters.agent);
  if (filters.status) params.set("status", filters.status);
  return `/api/messages?${params}`;
}

const selectChip = "min-h-11 shrink-0 rounded-full border border-line bg-transparent px-3 text-sm font-medium text-muted";

export function Feed({ filters, setFilters, onOpen }: { filters: Filters; setFilters: (next: Filters) => void; onOpen: (message: MessageDTO) => void }) {
  const key = feedKey(filters);
  const page = useQuery<MessagePage>(key, { interval: 5000 });
  const agents = useQuery<{ items: AgentDTO[] }>("/api/agents");
  const [older, setOlder] = useState<{ key: string; items: MessageDTO[]; nextBefore: number | null } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), 30_000);
  useEffect(() => setNow(Date.now()), [page.data]);

  const olderForKey = older?.key === key ? older : null;
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...(page.data?.items ?? []), ...(olderForKey?.items ?? [])].filter((item) => !seen.has(item.id) && seen.add(item.id));
  }, [page.data, olderForKey]);
  const nextBefore = olderForKey ? olderForKey.nextBefore : (page.data?.nextBefore ?? null);
  const filtered = Boolean(filters.priority || filters.agent || filters.status);

  async function loadOlder() {
    if (nextBefore === null) return;
    setLoadingOlder(true);
    try {
      const next = await api.get<MessagePage>(`${key}&before=${nextBefore}`);
      setOlder({ key, items: [...items, ...next.items], nextBefore: next.nextBefore });
    } catch {
      setOlder((current) => current);
    } finally {
      setLoadingOlder(false);
    }
  }

  return (
    <section aria-label="Messages">
      <div hidden={page.data?.items.length === 0 && !filtered} className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {PRIORITIES.toReversed().map((priority) => (
          <ChipButton key={priority} active={filters.priority === priority} onClick={() => setFilters({ ...filters, priority: filters.priority === priority ? "" : priority })}>
            <span className={`size-2 rounded-full ${priorityDot[priority]}`} aria-hidden />
            {PRIORITY_INFO[priority].label}
          </ChipButton>
        ))}
        <select
          aria-label="Filter by agent"
          value={filters.agent}
          onChange={(event) => setFilters({ ...filters, agent: event.target.value })}
          className={`${selectChip} ${filters.agent ? "border-accent bg-accent-soft text-fg" : ""}`}
        >
          <option value="">All agents</option>
          {agents.data?.items.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={filters.status}
          onChange={(event) => setFilters({ ...filters, status: event.target.value as MessageStatus | "" })}
          className={`${selectChip} ${filters.status ? "border-accent bg-accent-soft text-fg" : ""}`}
        >
          <option value="">Any status</option>
          {Object.entries(MESSAGE_STATUS).map(([value, info]) => (
            <option key={value} value={value}>
              {info.label}
            </option>
          ))}
        </select>
      </div>

      {Boolean(page.error) && !page.data && <ErrorBox error={errorMessage(page.error)} onRetry={() => void page.refetch()} />}
      {!page.data && !page.error && <SkeletonList rows={5} />}
      {page.data && items.length === 0 && (
        <EmptyState
          icon={<Inbox className="size-6" aria-hidden />}
          title={filtered ? copy.activity.emptyFiltered : copy.activity.emptyTitle}
          body={filtered ? "" : copy.activity.emptyBody}
          action={
            filtered && (
              <Button small onClick={() => setFilters({ priority: "", agent: "", status: "" })}>
                Remove filters
              </Button>
            )
          }
        />
      )}
      {items.length > 0 && (
        <ul className="-mx-3 space-y-0.5">
          {items.map((message) => (
            <MessageRow key={message.id} message={message} now={now} onOpen={() => onOpen(message)} />
          ))}
        </ul>
      )}
      {nextBefore !== null && items.length > 0 && (
        <div className="mt-4 flex justify-center">
          <Button busy={loadingOlder} onClick={() => void loadOlder()}>
            Load older
          </Button>
        </div>
      )}
    </section>
  );
}
