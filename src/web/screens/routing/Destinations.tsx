import { Check, X } from "lucide-react";
import type { ChannelDTO } from "../../../shared/api";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import type { Destination } from "../../../shared/settings";
import { channelTargets, destinationLabel, destinationName } from "../../lib/format";

const same = (a: Destination, b: Destination) => a.channelId === b.channelId && a.target === b.target;

export function DestinationChips({ value, channels, onRemove }: { value: Destination[]; channels: ChannelDTO[]; onRemove?: (destination: Destination) => void }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {value.map((destination) => {
        const info = destinationLabel(destination, channels);
        return (
          <li
            key={`${destination.channelId}:${destination.target}`}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border py-0.5 pl-2.5 text-sm ${onRemove ? "pr-0.5" : "pr-2.5"} ${info.stale ? "border-danger/50 text-danger" : "border-line"}`}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: info.color }} aria-hidden />
            {info.label}
            {info.stale && <span className="sr-only">(no longer available)</span>}
            {onRemove && (
              <button type="button" onClick={() => onRemove(destination)} className="-my-1.5 -mr-0.5 grid size-11 place-items-center rounded-full text-muted hover:bg-raised hover:text-fg" aria-label={`Remove ${info.label}`}>
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DestinationList({ value, channels, onChange }: { value: Destination[]; channels: ChannelDTO[]; onChange: (next: Destination[]) => void }) {
  const options: Destination[] = channels.flatMap((channel) => channelTargets(channel).map((target) => ({ channelId: channel.id, target })));
  const stale = value.filter((destination) => !options.some((option) => same(option, destination)));
  const toggle = (destination: Destination) =>
    onChange(value.some((item) => same(item, destination)) ? value.filter((item) => !same(item, destination)) : [...value, destination]);

  if (options.length === 0 && stale.length === 0) return <p className="text-sm text-muted">Add a channel first.</p>;

  return (
    <ul className="space-y-1.5">
      {[...options, ...stale].map((destination) => {
        const channel = channels.find((item) => item.id === destination.channelId);
        const checked = value.some((item) => same(item, destination));
        const label = channel ? destinationName(channel, destination.target) : destinationLabel(destination, channels).label;
        return (
          <li key={`${destination.channelId}:${destination.target}`}>
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              onClick={() => toggle(destination)}
              className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left ${checked ? "border-accent bg-accent-soft" : "border-line hover:border-muted/50"}`}
            >
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: channel ? CHANNEL_CATALOG[channel.kind].color : "#71717a" }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[15px]">{label}</span>
              <span className={`grid size-5 place-items-center rounded-md border ${checked ? "border-accent bg-accent text-white" : "border-line"}`} aria-hidden>
                {checked && <Check className="size-3.5" strokeWidth={3} />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
