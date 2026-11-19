import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { AgentDTO, ChannelDTO } from "../../../shared/api";
import { PRIORITIES, PRIORITY_INFO } from "../../../shared/priority";
import type { Rule } from "../../../shared/settings";
import { ChipButton, FieldGroup, Segmented, TextField, ToggleRow } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { Button, priorityDot } from "../../components/ui";
import { randomId } from "../../lib/format";
import { useQuery } from "../../lib/query";
import { DestinationList } from "./Destinations";

export function newRule(): Rule {
  return { id: `rule_${randomId(8)}`, name: "", enabled: true, match: {}, action: { type: "route", destinations: [] } };
}

function toggleIn<T>(list: T[] | undefined, item: T): T[] | undefined {
  const next = list?.includes(item) ? list.filter((value) => value !== item) : [...(list ?? []), item];
  return next.length > 0 ? next : undefined;
}

function RuleForm({ initial, channels, isNew, saving, onSave, onDelete }: { initial: Rule; channels: ChannelDTO[]; isNew: boolean; saving: boolean; onSave: (rule: Rule) => void; onDelete: () => void }) {
  const agents = useQuery<{ items: AgentDTO[] }>("/api/agents");
  const [rule, setRule] = useState(initial);
  const [topics, setTopics] = useState(initial.match.topics?.join(", ") ?? "");
  const [destinations, setDestinations] = useState(initial.action.type === "route" ? initial.action.destinations : []);
  const mute = rule.action.type === "mute";
  const name = rule.name.trim();
  const valid = name.length > 0 && name.length <= 80 && (mute || destinations.length > 0);

  function save() {
    const topicList = topics.split(",").map((topic) => topic.trim()).filter(Boolean);
    onSave({
      ...rule,
      name,
      match: { ...rule.match, topics: topicList.length > 0 ? topicList : undefined },
      action: mute ? { type: "mute" } : { type: "route", destinations },
    });
  }

  return (
    <div className="space-y-5">
      <TextField label="Name" placeholder="Deploys go to Telegram" maxLength={80} value={rule.name} onChange={(event) => setRule({ ...rule, name: event.target.value })} autoComplete="off" />
      <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">When</h3>
      <FieldGroup label="Priority" help="Select none to match every priority.">
        <div className="flex flex-wrap gap-2">
          {PRIORITIES.toReversed().map((priority) => (
            <ChipButton key={priority} active={Boolean(rule.match.priorities?.includes(priority))} onClick={() => setRule({ ...rule, match: { ...rule.match, priorities: toggleIn(rule.match.priorities, priority) } })}>
              <span className={`size-2 rounded-full ${priorityDot[priority]}`} aria-hidden />
              {PRIORITY_INFO[priority].label}
            </ChipButton>
          ))}
        </div>
      </FieldGroup>
      <TextField label="Topics" placeholder="deploy*, billing" help="Separate with commas. Use * to match the rest of a name. Leave empty to match every topic." value={topics} onChange={(event) => setTopics(event.target.value)} autoCapitalize="off" autoComplete="off" />
      <FieldGroup label="Agents" help="Select none to match every agent.">
        <div className="flex flex-wrap gap-2">
          {agents.data?.items
            .filter((agent) => agent.status === "active")
            .map((agent) => (
              <ChipButton key={agent.id} active={Boolean(rule.match.agentIds?.includes(agent.id))} onClick={() => setRule({ ...rule, match: { ...rule.match, agentIds: toggleIn(rule.match.agentIds, agent.id) } })}>
                {agent.name}
              </ChipButton>
            ))}
        </div>
      </FieldGroup>
      <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">Then</h3>
      <Segmented
        label="Action"
        value={mute ? "mute" : "route"}
        onChange={(type) => setRule({ ...rule, action: type === "mute" ? { type: "mute" } : { type: "route", destinations } })}
        options={[
          { value: "route", label: "Send to" },
          { value: "mute", label: "Mute" },
        ]}
      />
      {mute ? <p className="text-sm text-muted">Beep Me records messages that match this rule. It does not deliver them.</p> : <DestinationList value={destinations} channels={channels} onChange={setDestinations} />}
      <ToggleRow title="Rule is on" checked={rule.enabled} onChange={(enabled) => setRule({ ...rule, enabled })} />
      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
        {!isNew ? (
          <Button variant="danger" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            Delete rule
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" disabled={!valid} busy={saving} onClick={save}>
          {isNew ? "Add rule" : "Save rule"}
        </Button>
      </div>
    </div>
  );
}

export function RuleSheet({
  rule,
  isNew,
  channels,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  rule: Rule | null;
  isNew: boolean;
  channels: ChannelDTO[];
  saving: boolean;
  onClose: () => void;
  onSave: (rule: Rule) => void;
  onDelete: () => void;
}) {
  return (
    <Sheet open={rule !== null} onClose={onClose} title={isNew ? "New rule" : "Edit rule"}>
      {rule && <RuleForm key={rule.id} initial={rule} channels={channels} isNew={isNew} saving={saving} onSave={onSave} onDelete={onDelete} />}
    </Sheet>
  );
}
