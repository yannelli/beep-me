import { Plus, RadioTower } from "lucide-react";
import type { ChannelDTO } from "../../shared/api";
import { Button, EmptyState, ErrorBox, PageHeader, SkeletonList } from "../components/ui";
import { copy } from "../copy";
import { errorMessage } from "../lib/api";
import { useQuery } from "../lib/query";
import { navigate, useLocation } from "../lib/router";
import { AddChannelSheet } from "./channels/AddChannelSheet";
import { ChannelCard } from "./channels/ChannelCard";

export function Channels() {
  const channels = useQuery<{ items: ChannelDTO[] }>("/api/channels");
  const { search } = useLocation();
  const adding = search.get("add") === "1";
  const openAdd = () => navigate("/channels?add=1", { replace: true });
  const closeAdd = () => navigate("/channels", { replace: true });

  return (
    <>
      <PageHeader
        title={copy.nav.channels}
        subtitle={copy.channels.subtitle}
        action={
          channels.data && channels.data.items.length > 0 && (
            <Button variant="primary" small onClick={openAdd}>
              <Plus className="size-4" aria-hidden />
              Add channel
            </Button>
          )
        }
      />
      {Boolean(channels.error) && !channels.data && <ErrorBox error={errorMessage(channels.error)} onRetry={() => void channels.refetch()} />}
      {!channels.data && !channels.error && <SkeletonList rows={3} />}
      {channels.data?.items.length === 0 && (
        <EmptyState
          icon={<RadioTower className="size-6" aria-hidden />}
          title={copy.channels.emptyTitle}
          body={copy.channels.emptyBody}
          action={
            <Button variant="primary" onClick={openAdd}>
              <Plus className="size-4" aria-hidden />
              Add channel
            </Button>
          }
        />
      )}
      {channels.data && channels.data.items.length > 0 && (
        <ul className="space-y-3">
          {channels.data.items.map((channel) => (
            <ChannelCard key={channel.id} channel={channel} />
          ))}
        </ul>
      )}
      <AddChannelSheet open={adding} onClose={closeAdd} />
    </>
  );
}
