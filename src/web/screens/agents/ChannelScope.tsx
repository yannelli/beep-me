import type { ChannelDTO } from "../../../shared/api";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import { ChipButton, Segmented } from "../../components/form";
import { useQuery } from "../../lib/query";

export function scopeLabel(channelIds: string[] | null, channels: ChannelDTO[] | undefined): string {
  if (channelIds === null) return "All channels";
  if (channelIds.length === 0) return "No channels";
  const names = channelIds.map((id) => channels?.find((channel) => channel.id === id)?.name).filter(Boolean);
  if (names.length === 1) return names[0]!;
  return `${channelIds.length} channels`;
}

export function ChannelScope({ value, onChange }: { value: string[] | null; onChange: (next: string[] | null) => void }) {
  const channels = useQuery<{ items: ChannelDTO[] }>("/api/channels");
  const list = channels.data?.items ?? [];
  function toggle(id: string) {
    const current = value ?? [];
    onChange(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }
  return (
    <div className="space-y-3">
      <Segmented
        label="Channels this agent can use"
        value={value === null ? "all" : "pick"}
        onChange={(next) => onChange(next === "all" ? null : list.map((channel) => channel.id))}
        options={[
          { value: "all", label: "All channels" },
          { value: "pick", label: "Select channels" },
        ]}
      />
      {value !== null && (
        <div className="flex flex-wrap gap-2">
          {list.length === 0 && <p className="text-sm text-muted">No channels yet.</p>}
          {list.map((channel) => (
            <ChipButton key={channel.id} active={value.includes(channel.id)} onClick={() => toggle(channel.id)}>
              <span className="size-2 rounded-full" style={{ background: CHANNEL_CATALOG[channel.kind].color }} aria-hidden />
              {channel.name}
            </ChipButton>
          ))}
        </div>
      )}
    </div>
  );
}
