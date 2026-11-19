import { Trash2 } from "lucide-react";
import { useState } from "react";
import type { ChannelDTO } from "../../../shared/api";
import { PRIORITIES, PRIORITY_INFO, type Priority } from "../../../shared/priority";
import { FALLBACK_TRIGGERS, type FallbackStep } from "../../../shared/settings";
import { FieldGroup, Segmented, SelectField, TextField } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { Button } from "../../components/ui";
import { copy } from "../../copy";
import { randomId } from "../../lib/format";
import { DestinationList } from "./Destinations";

const MAX_DESTINATIONS = 5;
const MAX_MINUTES = 1440;

export function newFallbackStep(): FallbackStep {
  return { id: `fb_${randomId(8)}`, when: "no_reply", afterMinutes: 5, destinations: [], priority: null };
}

function FallbackForm({ initial, channels, isNew, saving, onSave, onDelete }: { initial: FallbackStep; channels: ChannelDTO[]; isNew: boolean; saving: boolean; onSave: (step: FallbackStep) => void; onDelete: () => void }) {
  const [step, setStep] = useState(initial);
  const [minutes, setMinutes] = useState(String(initial.afterMinutes));
  const minutesValue = /^\d+$/.test(minutes.trim()) ? Number(minutes.trim()) : NaN;
  const minutesError = Number.isInteger(minutesValue) && minutesValue <= MAX_MINUTES ? undefined : `Enter a number from 0 to ${MAX_MINUTES}.`;
  const destinationsError = step.destinations.length > MAX_DESTINATIONS ? `Select ${MAX_DESTINATIONS} or fewer.` : undefined;
  const valid = !minutesError && !destinationsError && step.destinations.length > 0;

  return (
    <div className="space-y-5">
      <FieldGroup label="When" help={copy.routing.fallbackTriggerHelp[step.when]}>
        <Segmented
          label="When"
          value={step.when}
          onChange={(when) => setStep({ ...step, when })}
          options={FALLBACK_TRIGGERS.map((trigger) => ({ value: trigger, label: copy.routing.fallbackTriggers[trigger] }))}
        />
      </FieldGroup>
      <TextField
        label="Minutes after the first send"
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_MINUTES}
        value={minutes}
        onChange={(event) => setMinutes(event.target.value)}
        error={minutes.trim() === "" ? undefined : minutesError}
        help="Beep Me checks every minute."
      />
      <FieldGroup label="Send to" help={destinationsError ? undefined : `Select 1 to ${MAX_DESTINATIONS}.`}>
        <DestinationList value={step.destinations} channels={channels} onChange={(destinations) => setStep({ ...step, destinations })} />
        {destinationsError && <p className="text-sm text-danger">{destinationsError}</p>}
      </FieldGroup>
      <SelectField
        label="Priority"
        value={step.priority ?? ""}
        onChange={(event) => setStep({ ...step, priority: (event.target.value || null) as Priority | null })}
        help="Quiet hours use this priority."
      >
        <option value="">{copy.routing.keepPriority}</option>
        {PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>
            {PRIORITY_INFO[priority].label}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
        {!isNew ? (
          <Button variant="danger" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            Delete step
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" disabled={!valid} busy={saving} onClick={() => onSave({ ...step, afterMinutes: minutesValue })}>
          {isNew ? "Add step" : "Save step"}
        </Button>
      </div>
    </div>
  );
}

export function FallbackSheet({
  editing,
  channels,
  saving,
  onClose,
  onSave,
  onDelete,
}: {
  editing: { priority: Priority; step: FallbackStep; isNew: boolean } | null;
  channels: ChannelDTO[];
  saving: boolean;
  onClose: () => void;
  onSave: (step: FallbackStep) => void;
  onDelete: () => void;
}) {
  const title = editing ? `${editing.isNew ? "New" : "Edit"} ${PRIORITY_INFO[editing.priority].label} fallback` : "";
  return (
    <Sheet open={editing !== null} onClose={onClose} title={title}>
      {editing && <FallbackForm key={editing.step.id} initial={editing.step} channels={channels} isNew={editing.isNew} saving={saving} onSave={onSave} onDelete={onDelete} />}
    </Sheet>
  );
}
