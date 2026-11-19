import { Moon } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { TopicDTO } from "../../../shared/api";
import type { Limits, QuietHours } from "../../../shared/settings";
import { ChipButton, FieldGroup, Segmented, TextField, Toggle, ToggleRow } from "../../components/form";
import { Badge, Button, Card, ErrorBox, Skeleton } from "../../components/ui";
import { copy } from "../../copy";
import { api, errorMessage } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { setQueryData, useQuery } from "../../lib/query";
import { useToast } from "../../lib/toast";
import { useSettings } from "./useSettings";

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const allDays = [0, 1, 2, 3, 4, 5, 6];

function QuietForm({ initial, quietNow }: { initial: QuietHours; quietNow: boolean }) {
  const { save, saving } = useSettings();
  const [quiet, setQuiet] = useState(initial);
  const days = quiet.days.length === 0 ? allDays : quiet.days;
  const dirty = JSON.stringify(quiet) !== JSON.stringify(initial);

  function toggleDay(day: number) {
    const next = days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort();
    if (next.length === 0) return;
    setQuiet({ ...quiet, days: next.length === 7 ? [] : next });
  }

  return (
    <Card
      title={copy.routing.quietTitle}
      action={
        quietNow && (
          <Badge tone="accent">
            <Moon className="size-3" aria-hidden />
            Quiet now
          </Badge>
        )
      }
    >
      <div className="space-y-4">
        <ToggleRow title="Use quiet hours" body={copy.routing.quietBody} checked={quiet.enabled} onChange={(enabled) => void save({ quietHours: { ...quiet, enabled } }).then((ok) => ok && setQuiet({ ...quiet, enabled }))} />
        {quiet.enabled && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Start" type="time" value={quiet.start} onChange={(event) => setQuiet({ ...quiet, start: event.target.value })} />
              <TextField label="End" type="time" value={quiet.end} onChange={(event) => setQuiet({ ...quiet, end: event.target.value })} />
            </div>
            <FieldGroup label="Days">
              <div className="flex flex-wrap gap-1.5">
                {dayNames.map((name, day) => (
                  <ChipButton key={name} active={days.includes(day)} onClick={() => toggleDay(day)}>
                    {name}
                  </ChipButton>
                ))}
              </div>
            </FieldGroup>
            <FieldGroup label="These still make sound">
              <Segmented
                label="Break through quiet hours"
                value={quiet.breakthrough}
                onChange={(breakthrough) => setQuiet({ ...quiet, breakthrough })}
                options={[
                  { value: "urgent", label: "Urgent only" },
                  { value: "high", label: "High and urgent" },
                ]}
              />
            </FieldGroup>
            <Button variant="primary" disabled={!dirty} busy={saving} onClick={() => void save({ quietHours: quiet }, "Quiet hours saved.")}>
              Save quiet hours
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

export function QuietHoursCard() {
  const { me } = useSettings();
  if (!me) return <Skeleton className="h-40" />;
  return <QuietForm key={JSON.stringify(me.settings.quietHours)} initial={me.settings.quietHours} quietNow={me.quietNow} />;
}

function LimitsForm({ initial }: { initial: Limits }) {
  const { save, saving } = useSettings();
  const [values, setValues] = useState({ smsPerHour: String(initial.smsPerHour), messagesPerHour: String(initial.messagesPerHour), collapseMinutes: String(initial.collapseMinutes) });
  const ranges = { smsPerHour: [0, 100], messagesPerHour: [1, 1000], collapseMinutes: [0, 1440] } as const;
  const errors = Object.fromEntries(
    Object.entries(ranges).map(([key, [min, max]]) => {
      const raw = values[key as keyof Limits];
      const value = Number(raw);
      return [key, raw.trim() === "" || !Number.isInteger(value) || value < min || value > max ? `Use a whole number from ${min} to ${max}.` : ""];
    }),
  );
  const valid = Object.values(errors).every((error) => !error);
  const dirty = Object.entries(values).some(([key, value]) => Number(value) !== initial[key as keyof Limits]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid) void save({ limits: { smsPerHour: Number(values.smsPerHour), messagesPerHour: Number(values.messagesPerHour), collapseMinutes: Number(values.collapseMinutes) } }, "Limits saved.");
  }

  const field = (key: keyof Limits, label: string, help: string) => (
    <TextField label={label} help={help} type="number" inputMode="numeric" value={values[key]} error={errors[key] || undefined} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
  );

  return (
    <Card title={copy.routing.limitsTitle}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-muted">{copy.routing.limitsBody}</p>
        {field("smsPerHour", "Texts per agent per hour", "Text messages cost money. If an agent goes over the limit, Beep Me uses your other channels.")}
        {field("messagesPerHour", "Messages per agent per hour", "Across all channels.")}
        {field("collapseMinutes", "Collapse window in minutes", "Repeats of the same message inside this window count as one.")}
        <Button type="submit" variant="primary" disabled={!dirty || !valid} busy={saving}>
          Save limits
        </Button>
      </form>
    </Card>
  );
}

export function LimitsCard() {
  const { me } = useSettings();
  if (!me) return <Skeleton className="h-40" />;
  return <LimitsForm key={JSON.stringify(me.settings.limits)} initial={me.settings.limits} />;
}

export function TopicsCard() {
  const topics = useQuery<{ items: TopicDTO[] }>("/api/topics");
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function setMuted(topic: TopicDTO, muted: boolean) {
    setBusy(topic.id);
    try {
      const updated = await api.patch<TopicDTO>(`/api/topics/${topic.id}`, { muted });
      setQueryData<{ items: TopicDTO[] }>("/api/topics", (list) => ({ items: (list?.items ?? []).map((item) => (item.id === updated.id ? updated : item)) }));
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title={copy.routing.topicsTitle}>
      <p className="mb-4 text-sm text-muted">{copy.routing.topicsBody}</p>
      {Boolean(topics.error) && !topics.data && <ErrorBox error={errorMessage(topics.error)} onRetry={() => void topics.refetch()} />}
      {!topics.data && !topics.error && <Skeleton className="h-24" />}
      {topics.data?.items.length === 0 && <p className="text-sm text-muted">{copy.routing.topicsEmpty}</p>}
      <ul className="divide-y divide-line">
        {topics.data?.items.map((topic) => (
          <li key={topic.id} className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium">#{topic.name}</p>
              <p className="text-sm text-muted">
                {topic.messageCount} messages · last {relativeTime(topic.lastUsedAt)}
                {topic.muted && " · muted"}
              </p>
            </div>
            <Toggle checked={!topic.muted} label={`Deliver #${topic.name}`} disabled={busy === topic.id} onChange={(on) => void setMuted(topic, !on)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
