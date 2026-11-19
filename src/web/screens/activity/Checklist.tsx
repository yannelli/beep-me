import { CircleCheck, CircleDashed } from "lucide-react";
import type { MeResponse } from "../../../shared/api";
import { copy } from "../../copy";
import { navigate } from "../../lib/router";

export function checklistDone(me: MeResponse) {
  return me.counts.channels > 0 && me.counts.messages > 0 && me.counts.agents > 0;
}

export function Checklist({ me, onSendTest }: { me: MeResponse; onSendTest: () => void }) {
  const items = [
    { ...copy.activity.checklist.channel, done: me.counts.channels > 0, run: () => navigate("/channels?add=1") },
    { ...copy.activity.checklist.test, done: me.counts.messages > 0, run: onSendTest },
    { ...copy.activity.checklist.agent, done: me.counts.agents > 0, run: () => navigate("/agents?connect=1") },
  ];
  const nextIndex = items.findIndex((item) => !item.done);
  const doneCount = items.filter((item) => item.done).length;

  return (
    <section className="rounded-2xl border border-accent/40 bg-accent-soft p-4" aria-labelledby="checklist-title">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="checklist-title" className="font-semibold">
          {copy.activity.checklistTitle}
        </h2>
        <span className="text-sm text-muted">{doneCount} of 3 done</span>
      </div>
      <ol className="space-y-1">
        {items.map((item, index) => (
          <li key={item.title} className="flex items-center gap-3 rounded-xl py-2">
            {item.done ? (
              <CircleCheck className="size-6 shrink-0 text-ok" aria-label="Done" />
            ) : (
              <CircleDashed className="size-6 shrink-0 text-muted" aria-label="To do" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`font-medium ${item.done ? "text-muted line-through" : ""}`}>{item.title}</p>
              {!item.done && <p className="text-sm text-muted">{item.body}</p>}
            </div>
            {!item.done && (
              <button
                type="button"
                onClick={item.run}
                className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium ${index === nextIndex ? "bg-accent text-accent-fg" : "border border-line bg-surface"}`}
              >
                {item.action}
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
