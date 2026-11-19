import { ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ChannelDTO } from "../../../shared/api";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import { Toggle } from "../../components/form";
import { Badge, BrandDot, type Tone } from "../../components/ui";
import { api, errorMessage } from "../../lib/api";
import { channelTargets, targetLabel } from "../../lib/format";
import { setQueryData } from "../../lib/query";
import { Link } from "../../lib/router";
import { useToast } from "../../lib/toast";
import { ChannelTests } from "./ChannelTests";

export function channelStatus(channel: ChannelDTO): { label: string; tone: Tone } {
  if (!channel.enabled) return { label: "Off", tone: "neutral" };
  if (channel.status === "error") return { label: "Error", tone: "error" };
  if (channel.status === "needs_setup") return { label: "Needs setup", tone: "warn" };
  return { label: "Ready", tone: "ok" };
}

export function useChannelToggle(channel: ChannelDTO) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const updated = await api.patch<ChannelDTO>(`/api/channels/${channel.id}`, { enabled });
      setQueryData<{ items: ChannelDTO[] }>("/api/channels", (list) => ({ items: (list?.items ?? []).map((item) => (item.id === updated.id ? updated : item)) }));
      setQueryData(`/api/channels/${channel.id}`, updated);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }
  return { busy, toggle };
}

function subtitle(channel: ChannelDTO): string {
  const parts = channel.name === CHANNEL_CATALOG[channel.kind].name ? [] : [CHANNEL_CATALOG[channel.kind].name];
  if (channel.kind === "telegram" || channel.targets.includes("topic")) parts.push(channelTargets(channel).map((target, index) => (index === 0 ? targetLabel(channel, target) : targetLabel(channel, target).toLowerCase())).join(" and "));
  return parts.join(" · ") || CHANNEL_CATALOG[channel.kind].tagline;
}

export function ChannelCard({ channel }: { channel: ChannelDTO }) {
  const info = CHANNEL_CATALOG[channel.kind];
  const status = channelStatus(channel);
  const { busy, toggle } = useChannelToggle(channel);

  return (
    <li className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-3 p-4 pb-3">
        <Link href={`/channels/${channel.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl">
          <BrandDot color={info.color}>
            <span className="text-sm font-bold">{info.name[0]}</span>
          </BrandDot>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2">
              <span className="truncate font-semibold">{channel.name}</span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </span>
            <span className="block truncate text-sm text-muted">{subtitle(channel)}</span>
          </span>
        </Link>
        <Toggle checked={channel.enabled} onChange={(next) => void toggle(next)} label={`Turn ${channel.name} on or off`} disabled={busy} />
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line px-4 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <Badge tone={status.tone}>{status.label}</Badge>
          {channel.statusDetail && <p className="text-sm text-muted">{channel.statusDetail}</p>}
        </div>
        {channel.status !== "needs_setup" && <ChannelTests channel={channel} />}
        {channel.status === "needs_setup" && (
          <Link href={`/channels/${channel.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-accent px-3 text-sm font-medium text-accent-fg">
            Finish setup
          </Link>
        )}
      </div>
    </li>
  );
}
