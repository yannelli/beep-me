import { CornerDownRight, FileText, MousePointerClick, Paperclip, SmilePlus, Vote } from "lucide-react";
import type { AttachmentDTO, InteractionDTO, InteractionMediaDTO, MessageDTO } from "../../../shared/api";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import { Badge } from "../../components/ui";
import { dateTime } from "../../lib/format";

function FileLink({ file }: { file: AttachmentDTO | InteractionMediaDTO }) {
  if (file.kind === "image") {
    return (
      <a href={file.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-line">
        <img src={file.url} alt={file.name} loading="lazy" className="max-h-64 w-full object-contain bg-raised" />
      </a>
    );
  }
  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm hover:bg-raised">
      <FileText className="size-4 shrink-0 text-muted" aria-hidden />
      <span className="truncate">{file.name}</span>
    </a>
  );
}

const kindIcon = { reply: CornerDownRight, choice: MousePointerClick, reaction: SmilePlus, vote: Vote };

function Interaction({ item }: { item: InteractionDTO }) {
  const Icon = kindIcon[item.kind];
  const text = item.option ? `Chose "${item.option.label}"` : item.kind === "reaction" ? `Reacted ${item.text ?? ""}` : (item.text ?? "");
  return (
    <li className="space-y-2 rounded-xl border border-line bg-raised/50 p-3">
      <p className="flex items-center gap-2 text-xs text-muted">
        <Icon className="size-3.5" aria-hidden />
        {item.sender ?? "You"} · {CHANNEL_CATALOG[item.channelKind].name} · {dateTime(item.createdAt)}
      </p>
      {text && <p className="text-[15px] break-words whitespace-pre-wrap">{text}</p>}
      {item.media.map((file) => (
        <FileLink key={file.url} file={file} />
      ))}
      {item.readAt === null && <Badge tone="accent">Not read by the agent yet</Badge>}
    </li>
  );
}

/** Files, offered choices, and the answers that came back for one message. */
export function MessageExtras({ message }: { message: MessageDTO }) {
  return (
    <>
      {message.attachments.length > 0 && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <Paperclip className="size-4" aria-hidden /> Files
          </h3>
          {message.attachments.map((file) => (
            <FileLink key={file.url} file={file} />
          ))}
        </section>
      )}
      {message.options.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Choices offered</h3>
          <ol className="flex flex-wrap gap-2">
            {message.options.map((option, index) => (
              <li key={option} className="rounded-full border border-line px-3 py-1 text-sm">
                {index + 1}. {option}
              </li>
            ))}
          </ol>
        </section>
      )}
      {(message.interactions.length > 0 || message.expectReply) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Replies</h3>
          {message.interactions.length ? (
            <ul className="space-y-2">
              {message.interactions.map((item) => (
                <Interaction key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No reply yet. The agent is waiting for one.</p>
          )}
        </section>
      )}
    </>
  );
}
