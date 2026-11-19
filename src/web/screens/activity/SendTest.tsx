import { Send } from "lucide-react";
import { useState, type Ref } from "react";
import type { MessageDTO } from "../../../shared/api";
import type { Priority } from "../../../shared/priority";
import { PriorityPicker } from "../../components/PriorityPicker";
import { Button } from "../../components/ui";
import { copy } from "../../copy";
import { api, errorMessage } from "../../lib/api";
import { fetchQuery, invalidate } from "../../lib/query";
import { useToast } from "../../lib/toast";

function summary(message: MessageDTO): { text: string; ok: boolean } {
  const reached = message.deliveries.filter((delivery) => delivery.status !== "failed").map((delivery) => delivery.channelName);
  if (reached.length > 0) return { text: `Test sent to ${[...new Set(reached)].join(", ")}.`, ok: true };
  if (message.deliveries.length > 0) return { text: "The test failed on every channel. Tap it in the list to see why.", ok: false };
  return { text: "No channel got the test. Add a channel or check Routing.", ok: false };
}

export function SendTest({ onSent, ref }: { onSent: (message: MessageDTO) => void; ref?: Ref<HTMLButtonElement> }) {
  const [priority, setPriority] = useState<Priority>("medium");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function send() {
    setBusy(true);
    try {
      const message = await api.post<MessageDTO>("/api/messages/test", { priority });
      const result = summary(message);
      toast(result.text, result.ok ? "ok" : "error");
      onSent(message);
      invalidate("/api/messages?");
      void fetchQuery("/api/me");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4" aria-labelledby="send-test-title">
      <h2 id="send-test-title" className="font-semibold">
        {copy.activity.testTitle}
      </h2>
      <p className="mb-3 text-sm text-muted">{copy.activity.testBody}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <PriorityPicker label="Test priority" value={priority} onChange={setPriority} />
        </div>
        <Button ref={ref} variant="primary" busy={busy} onClick={() => void send()}>
          {!busy && <Send className="size-4" aria-hidden />}
          Send test
        </Button>
      </div>
    </section>
  );
}
