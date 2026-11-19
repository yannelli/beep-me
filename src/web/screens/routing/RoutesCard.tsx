import { Pencil, Sparkles } from "lucide-react";
import { useState } from "react";
import type { ChannelDTO } from "../../../shared/api";
import { PRIORITIES, PRIORITY_INFO, type Priority } from "../../../shared/priority";
import type { Destination, Routes } from "../../../shared/settings";
import { Sheet } from "../../components/Sheet";
import { Badge, Button, Card, PriorityChip } from "../../components/ui";
import { copy } from "../../copy";
import { DestinationChips, DestinationList } from "./Destinations";
import { useSettings } from "./useSettings";

export function RoutesCard({ channels }: { channels: ChannelDTO[] }) {
  const { settings, save, saving } = useSettings();
  const [editing, setEditing] = useState<Priority | null>(null);
  const [draft, setDraft] = useState<Destination[]>([]);
  if (!settings) return null;
  const routes = settings.routes;

  function update(priority: Priority, destinations: Destination[]) {
    const next: Routes = { ...routes, [priority]: destinations };
    return save({ routes: next, routesCustomized: true });
  }

  function open(priority: Priority) {
    setDraft(routes[priority]);
    setEditing(priority);
  }

  return (
    <Card
      title={copy.routing.routesTitle}
      action={
        settings.routesCustomized ? (
          <Button small variant="ghost" busy={saving} onClick={() => void save({ routesCustomized: false }, "Beep Me sets routes from your channels again.")}>
            Use automatic
          </Button>
        ) : (
          <Badge tone="accent">
            <Sparkles className="size-3" aria-hidden />
            Automatic
          </Badge>
        )
      }
    >
      <p className="mb-4 text-sm text-muted">{settings.routesCustomized ? copy.routing.routesCustom : copy.routing.routesAuto}</p>
      <ul className="divide-y divide-line">
        {PRIORITIES.toReversed().map((priority) => (
          <li key={priority} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
                <PriorityChip priority={priority} />
                <p className="text-sm text-muted">{PRIORITY_INFO[priority].guidance}</p>
              </div>
              <Button small variant="ghost" onClick={() => open(priority)} aria-label={`Edit ${PRIORITY_INFO[priority].label} route`}>
                <Pencil className="size-4" aria-hidden />
                Edit
              </Button>
            </div>
            <div className="mt-2">
              {routes[priority].length === 0 ? (
                <p className="text-sm text-muted italic">{copy.routing.noDestinations}</p>
              ) : (
                <DestinationChips
                  value={routes[priority]}
                  channels={channels}
                  onRemove={(destination) => void update(priority, routes[priority].filter((item) => item !== destination))}
                />
              )}
            </div>
          </li>
        ))}
      </ul>
      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `${PRIORITY_INFO[editing].label} messages go to` : ""}
        footer={
          <Button
            variant="primary"
            className="w-full"
            busy={saving}
            onClick={() => editing && void update(editing, draft).then((ok) => ok && setEditing(null))}
          >
            Save route
          </Button>
        }
      >
        <DestinationList value={draft} channels={channels} onChange={setDraft} />
      </Sheet>
    </Card>
  );
}
