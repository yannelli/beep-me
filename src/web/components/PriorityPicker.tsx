import { PRIORITIES, PRIORITY_INFO, type Priority } from "../../shared/priority";
import { Segmented } from "./form";
import { priorityDot } from "./ui";

export function PriorityPicker({ value, onChange, label }: { value: Priority; onChange: (next: Priority) => void; label: string }) {
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      options={PRIORITIES.map((priority) => ({
        value: priority,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${priorityDot[priority]}`} aria-hidden />
            {PRIORITY_INFO[priority].label}
          </span>
        ),
      }))}
    />
  );
}
