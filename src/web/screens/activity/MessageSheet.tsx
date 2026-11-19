import { ArrowRight, ExternalLink, Moon } from "lucide-react";
import type { ReactNode } from "react";
import type { MessageDTO } from "../../../shared/api";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import { Sheet } from "../../components/Sheet";
import { Avatar, Badge, BrandDot, ErrorBox, PriorityChip, SkeletonList } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { dateTime, destinationName } from "../../lib/format";
import { useQuery } from "../../lib/query";
import { MessageExtras } from "./MessageExtras";
import { DELIVERY_STATUS, MESSAGE_STATUS } from "./status";

const sources: Record<MessageDTO["source"], string> = { mcp: "MCP", api: "API", test: "Test", system: "Beep Me" };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-b border-line py-2 last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="flex flex-wrap items-center justify-end gap-1.5 text-right text-sm">{children}</dd>
    </div>
  );
}

export function MessageSheet({ id, initial, onClose }: { id: string | null; initial: MessageDTO | null; onClose: () => void }) {
  const fresh = useQuery<MessageDTO>(id ? `/api/messages/${id}` : null);
  const message = fresh.data ?? (initial?.id === id ? initial : null);

  return (
    <Sheet open={id !== null} onClose={onClose} title={message?.title ?? "Message"}>
      {!message && !fresh.error && <SkeletonList rows={3} />}
      {!message && Boolean(fresh.error) && <ErrorBox error={errorMessage(fresh.error)} onRetry={() => void fresh.refetch()} />}
      {message && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={message.agentName} size={36} />
            <div className="min-w-0">
              <p className="truncate font-medium">{message.senderName ? `${message.senderName} (${message.agentName})` : message.agentName}</p>
              <p className="text-sm text-muted">{dateTime(message.createdAt)}</p>
            </div>
          </div>
          <p className="text-[15px] break-words whitespace-pre-wrap">{message.body}</p>
          {message.url && (
            <a href={message.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 break-all font-medium text-accent">
              {message.url}
              <ExternalLink className="size-4 shrink-0" aria-hidden />
            </a>
          )}
          <MessageExtras message={message} />

          <dl className="rounded-xl border border-line px-3">
            <Row label="Priority">
              {message.requestedPriority !== message.priority && (
                <>
                  <PriorityChip priority={message.requestedPriority} />
                  <ArrowRight className="size-3.5 text-muted" aria-label="lowered to" />
                </>
              )}
              <PriorityChip priority={message.priority} />
            </Row>
            <Row label="Status">
              <Badge tone={MESSAGE_STATUS[message.status].tone}>{MESSAGE_STATUS[message.status].label}</Badge>
            </Row>
            {message.topic && <Row label="Topic">#{message.topic.name}</Row>}
            {message.repeatCount > 1 && <Row label="Repeats">×{message.repeatCount}, last {message.lastRepeatAt ? dateTime(message.lastRepeatAt) : ""}</Row>}
            {message.quiet && (
              <Row label="Quiet hours">
                <Moon className="size-3.5" aria-hidden /> {message.status === "muted" ? "Held" : "Yes"}
              </Row>
            )}
            <Row label="Sent with">{sources[message.source]}</Row>
          </dl>

          {message.notes.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold">Routing notes</h3>
              <ul className="space-y-1.5 text-sm text-muted">
                {message.notes.map((note) => (
                  <li key={note} className="rounded-xl bg-raised px-3 py-2">
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold">Deliveries</h3>
            {message.deliveries.length === 0 ? (
              <p className="text-sm text-muted">No channel got this message.</p>
            ) : (
              <ul className="space-y-2">
                {message.deliveries.map((delivery) => {
                  const status = DELIVERY_STATUS[delivery.status];
                  return (
                    <li key={delivery.id} className="flex items-start gap-3 rounded-xl border border-line p-3">
                      <BrandDot color={CHANNEL_CATALOG[delivery.channelKind].color} size={28} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-medium">
                            {destinationName({ kind: delivery.channelKind, name: delivery.channelName }, delivery.target)}
                          </p>
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </div>
                        {delivery.detail && <p className="mt-1 text-sm break-words text-muted">{delivery.detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}
