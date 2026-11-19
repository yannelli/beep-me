import { Moon } from "lucide-react";
import type { MessageDTO } from "../../../shared/api";
import { Avatar, Badge, PriorityChip } from "../../components/ui";
import { relativeTime } from "../../lib/format";
import { MESSAGE_STATUS } from "./status";

export function MessageRow({ message, onOpen, now }: { message: MessageDTO; onOpen: () => void; now: number }) {
  const status = MESSAGE_STATUS[message.status];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors duration-150 hover:bg-raised"
      >
        <Avatar name={message.agentName} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm text-muted">{message.agentName}</span>
            <time className="shrink-0 text-xs text-muted" dateTime={new Date(message.createdAt).toISOString()}>
              {relativeTime(message.lastRepeatAt ?? message.createdAt, now)}
            </time>
          </span>
          <span className={`mt-0.5 line-clamp-2 text-[15px] ${message.title ? "font-semibold" : ""}`}>{message.title ?? message.body}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <PriorityChip priority={message.priority} />
            {message.topic && <Badge>#{message.topic.name}</Badge>}
            {message.status !== "delivered" && <Badge tone={status.tone}>{status.label}</Badge>}
            {message.repeatCount > 1 && <Badge tone="accent">×{message.repeatCount}</Badge>}
            {message.interactions.length > 0 && <Badge tone="ok">{message.interactions.length === 1 ? "1 reply" : `${message.interactions.length} replies`}</Badge>}
            {message.interactions.length === 0 && message.expectReply && <Badge tone="warn">Awaiting reply</Badge>}
            {message.attachments.length > 0 && <Badge>{message.attachments.length === 1 ? "1 file" : `${message.attachments.length} files`}</Badge>}
            {message.quiet && (
              <Badge>
                <Moon className="size-3" aria-hidden />
                Quiet
              </Badge>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
