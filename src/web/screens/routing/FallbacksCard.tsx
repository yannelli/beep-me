import { ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import type { ChannelDTO } from "../../../shared/api";
import { PRIORITIES, PRIORITY_INFO, type Priority } from "../../../shared/priority";
import type { FallbackStep } from "../../../shared/settings";
import { Button, Card, PriorityChip } from "../../components/ui";
import { copy } from "../../copy";
import { afterLabel, destinationLabel } from "../../lib/format";
import { FallbackSheet, newFallbackStep } from "./FallbackSheet";
import { useSettings } from "./useSettings";

const MAX_STEPS = 5;

function stepSentence(step: FallbackStep, channels: ChannelDTO[]): string {
  const where = step.destinations.map((destination) => destinationLabel(destination, channels).label).join(", ");
  const at = step.priority ? `, at ${PRIORITY_INFO[step.priority].label}` : "";
  return `${copy.routing.fallbackTriggers[step.when]} ${afterLabel(step.afterMinutes)}: ${where}${at}`;
}

export function FallbacksCard({ channels }: { channels: ChannelDTO[] }) {
  const { settings, save, saving } = useSettings();
  const [editing, setEditing] = useState<{ priority: Priority; step: FallbackStep; isNew: boolean } | null>(null);
  if (!settings) return null;
  const fallbacks = settings.fallbacks;

  async function commit(priority: Priority, steps: FallbackStep[], message: string) {
    if (await save({ fallbacks: { ...fallbacks, [priority]: steps } }, message)) setEditing(null);
  }

  function onSave(step: FallbackStep) {
    if (!editing) return;
    const steps = fallbacks[editing.priority];
    const exists = steps.some((item) => item.id === step.id);
    void commit(editing.priority, exists ? steps.map((item) => (item.id === step.id ? step : item)) : [...steps, step], exists ? "Step saved." : "Step added.");
  }

  function onDelete() {
    if (!editing) return;
    void commit(editing.priority, fallbacks[editing.priority].filter((item) => item.id !== editing.step.id), "Step deleted.");
  }

  return (
    <Card title={copy.routing.fallbacksTitle}>
      <p className="mb-4 text-sm text-muted">{copy.routing.fallbacksBody}</p>
      <ul className="divide-y divide-line">
        {PRIORITIES.toReversed().map((priority) => {
          const steps = fallbacks[priority];
          return (
            <li key={priority} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <PriorityChip priority={priority} />
                <Button
                  small
                  variant="ghost"
                  disabled={steps.length >= MAX_STEPS}
                  onClick={() => setEditing({ priority, step: newFallbackStep(), isNew: true })}
                  aria-label={`Add ${PRIORITY_INFO[priority].label} fallback step`}
                >
                  <Plus className="size-4" aria-hidden />
                  Add step
                </Button>
              </div>
              {steps.length === 0 ? (
                <p className="mt-1 text-sm text-muted italic">{copy.routing.fallbacksNone}</p>
              ) : (
                <ol className="mt-2 space-y-1.5">
                  {steps.map((step) => (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => setEditing({ priority, step, isNew: false })}
                        className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-line px-3 py-2 text-left text-sm hover:border-muted/50"
                      >
                        <span className="min-w-0 flex-1 break-words">{stepSentence(step, channels)}</span>
                        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          );
        })}
      </ul>
      <FallbackSheet editing={editing} channels={channels} saving={saving} onClose={() => setEditing(null)} onSave={onSave} onDelete={onDelete} />
    </Card>
  );
}
