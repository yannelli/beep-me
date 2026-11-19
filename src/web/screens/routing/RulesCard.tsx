import { ChevronDown, ChevronUp, Plus } from "lucide-react";
import { useState } from "react";
import type { AgentDTO, ChannelDTO } from "../../../shared/api";
import { PRIORITY_INFO } from "../../../shared/priority";
import type { Rule } from "../../../shared/settings";
import { Toggle } from "../../components/form";
import { Badge, Button, Card } from "../../components/ui";
import { copy } from "../../copy";
import { useQuery } from "../../lib/query";
import { DestinationChips } from "./Destinations";
import { newRule, RuleSheet } from "./RuleSheet";
import { useSettings } from "./useSettings";

function matchSummary(rule: Rule, agents: AgentDTO[]): string {
  const parts: string[] = [];
  if (rule.match.priorities?.length) parts.push(rule.match.priorities.map((priority) => PRIORITY_INFO[priority].label).join(" or "));
  if (rule.match.topics?.length) parts.push(`topic ${rule.match.topics.join(", ")}`);
  if (rule.match.agentIds?.length) parts.push(rule.match.agentIds.map((id) => agents.find((agent) => agent.id === id)?.name ?? "deleted agent").join(", "));
  return parts.length > 0 ? `When ${parts.join(" · ")}` : "Every message";
}

export function RulesCard({ channels }: { channels: ChannelDTO[] }) {
  const { settings, save, saving } = useSettings();
  const agents = useQuery<{ items: AgentDTO[] }>("/api/agents");
  const [editing, setEditing] = useState<{ rule: Rule; isNew: boolean } | null>(null);
  if (!settings) return null;
  const rules = settings.rules;

  async function commit(next: Rule[], message?: string) {
    if (await save({ rules: next }, message)) setEditing(null);
  }

  function move(index: number, offset: number) {
    const next = [...rules];
    const [rule] = next.splice(index, 1);
    next.splice(index + offset, 0, rule!);
    void commit(next);
  }

  function onSave(rule: Rule) {
    const exists = rules.some((item) => item.id === rule.id);
    void commit(exists ? rules.map((item) => (item.id === rule.id ? rule : item)) : [...rules, rule], exists ? "Rule saved." : "Rule added.");
  }

  return (
    <Card
      title={copy.routing.rulesTitle}
      action={
        <Button small variant="ghost" disabled={rules.length >= 50} onClick={() => setEditing({ rule: newRule(), isNew: true })}>
          <Plus className="size-4" aria-hidden />
          Add rule
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted">{copy.routing.rulesBody}</p>
      {rules.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{copy.routing.rulesEmpty}</p>}
      <ol className="space-y-2">
        {rules.map((rule, index) => (
          <li key={rule.id} className={`flex items-center gap-2 rounded-xl border border-line p-2 pl-3 ${rule.enabled ? "" : "opacity-60"}`}>
            <span className="w-5 shrink-0 text-center text-sm font-semibold text-muted">{index + 1}</span>
            <button type="button" onClick={() => setEditing({ rule, isNew: false })} className="min-w-0 flex-1 space-y-1.5 rounded-lg py-1 text-left">
              <span className="block truncate font-medium">{rule.name}</span>
              <span className="block truncate text-sm text-muted">{matchSummary(rule, agents.data?.items ?? [])}</span>
              {rule.action.type === "mute" ? <Badge>Mute</Badge> : <DestinationChips value={rule.action.destinations} channels={channels} />}
            </button>
            <div className="flex shrink-0 flex-col">
              <button type="button" disabled={index === 0 || saving} onClick={() => move(index, -1)} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-raised disabled:opacity-30" aria-label={`Move ${rule.name} up`}>
                <ChevronUp className="size-5" aria-hidden />
              </button>
              <button type="button" disabled={index === rules.length - 1 || saving} onClick={() => move(index, 1)} className="grid size-11 place-items-center rounded-lg text-muted hover:bg-raised disabled:opacity-30" aria-label={`Move ${rule.name} down`}>
                <ChevronDown className="size-5" aria-hidden />
              </button>
            </div>
            <Toggle checked={rule.enabled} label={`${rule.name} on or off`} disabled={saving} onChange={(enabled) => void commit(rules.map((item) => (item.id === rule.id ? { ...item, enabled } : item)))} />
          </li>
        ))}
      </ol>
      <RuleSheet
        rule={editing?.rule ?? null}
        isNew={editing?.isNew ?? false}
        channels={channels}
        saving={saving}
        onClose={() => setEditing(null)}
        onSave={onSave}
        onDelete={() => editing && void commit(rules.filter((item) => item.id !== editing.rule.id), "Rule deleted.")}
      />
    </Card>
  );
}
