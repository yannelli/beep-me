import type { ChannelDTO } from "../../shared/api";
import { BookOpen, Plus } from "lucide-react";
import { PageHeader, Skeleton } from "../components/ui";
import { Link } from "../lib/router";
import { copy } from "../copy";
import { useQuery } from "../lib/query";
import { FallbacksCard } from "./routing/FallbacksCard";
import { LimitsCard, QuietHoursCard, TopicsCard } from "./routing/QuietLimitsTopics";
import { RoutesCard } from "./routing/RoutesCard";
import { RulesCard } from "./routing/RulesCard";
import { useSettings } from "./routing/useSettings";

export function Routing() {
  const channels = useQuery<{ items: ChannelDTO[] }>("/api/channels");
  const { me } = useSettings();
  const list = channels.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={copy.nav.routing}
        subtitle={copy.routing.subtitle}
        action={
          <Link href="/docs/routing/routes-and-rules" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent">
            <BookOpen className="size-4" aria-hidden />
            <span className="hidden sm:inline">{copy.docs.routingHelp}</span>
            <span className="sm:hidden">{copy.docs.link}</span>
          </Link>
        }
      />
      <div className="space-y-4">
        {channels.data && list.length === 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-4">
            <p className="text-sm">{copy.routing.noChannels}</p>
            <Link href="/channels?add=1" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg">
              <Plus className="size-4" aria-hidden />
              Add channel
            </Link>
          </div>
        )}
        {!me || !channels.data ? (
          <>
            <Skeleton className="h-80" />
            <Skeleton className="h-40" />
          </>
        ) : (
          <>
            <RoutesCard channels={list} />
            <FallbacksCard channels={list} />
            <RulesCard channels={list} />
          </>
        )}
        <QuietHoursCard />
        <LimitsCard />
        <TopicsCard />
      </div>
    </>
  );
}
