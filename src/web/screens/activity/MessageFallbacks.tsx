import { ThumbsUp, X } from "lucide-react";
import { useState } from "react";
import type { FallbackDTO, MessageDTO } from "../../../shared/api";
import { Badge, Button, PriorityChip } from "../../components/ui";
import { copy } from "../../copy";
import { ackMessage, cancelFallbacks, errorMessage } from "../../lib/api";
import { afterLabel, dateTime } from "../../lib/format";
import { invalidate, setQueryData } from "../../lib/query";
import { useToast } from "../../lib/toast";
import { FALLBACK_STATUS } from "./status";

function timing(step: FallbackDTO): string {
  if (step.status === "pending") return `Due ${dateTime(step.dueAt)}`;
  if (step.status === "sending") return "Sending now";
  return dateTime(step.firedAt ?? step.dueAt);
}

function Step({ step }: { step: FallbackDTO }) {
  const status = FALLBACK_STATUS[step.status];
  return (
    <li className="space-y-1 rounded-xl border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-medium">
          {copy.routing.fallbackTriggers[step.when]} {afterLabel(step.afterMinutes)}
        </p>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <span className="break-words">{step.channels.join(", ")}</span>
        {step.priority && <PriorityChip priority={step.priority} />}
      </p>
      <p className="text-sm text-muted">
        {timing(step)}
        {step.source === "agent" && " · Set by the agent"}
      </p>
      {step.detail && <p className="text-sm break-words text-muted">{step.detail}</p>}
    </li>
  );
}

export function FallbackList({ message }: { message: MessageDTO }) {
  if (message.fallbacks.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{copy.routing.fallbacksTitle}</h3>
      <ul className="space-y-2">
        {message.fallbacks.map((step) => (
          <Step key={step.id} step={step} />
        ))}
      </ul>
    </section>
  );
}

/** Got it and Cancel fallbacks. Both endpoints return the updated message. */
export function MessageActions({ message }: { message: MessageDTO }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"ack" | "cancel" | null>(null);
  const canAck = message.interactions.length === 0 && message.deliveries.length > 0;
  const canCancel = message.fallbacks.some((step) => step.status === "pending");
  if (!canAck && !canCancel) return null;

  async function run(action: "ack" | "cancel", call: (id: string) => Promise<MessageDTO>, done: string) {
    setBusy(action);
    try {
      setQueryData(`/api/messages/${message.id}`, await call(message.id));
      invalidate("/api/messages?");
      toast(done);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {canAck && (
        <Button busy={busy === "ack"} disabled={busy !== null} onClick={() => void run("ack", ackMessage, "Marked as seen. The agent gets a 👍.")}>
          <ThumbsUp className="size-4" aria-hidden />
          Got it
        </Button>
      )}
      {canCancel && (
        <Button busy={busy === "cancel"} disabled={busy !== null} onClick={() => void run("cancel", cancelFallbacks, "Fallbacks canceled.")}>
          <X className="size-4" aria-hidden />
          Cancel fallbacks
        </Button>
      )}
    </div>
  );
}
