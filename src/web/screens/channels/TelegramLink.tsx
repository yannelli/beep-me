import { CircleCheck, ExternalLink, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ChannelDTO, TelegramLink as LinkDTO } from "../../../shared/api";
import { Button, ErrorBox } from "../../components/ui";
import { copy } from "../../copy";
import { api, errorMessage } from "../../lib/api";
import { fetchQuery, invalidate, setQueryData, useQuery } from "../../lib/query";

type Purpose = "main" | "topics";

function OpenTelegram({ link, label }: { link: LinkDTO; label: string }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#229ED9] px-4 font-medium text-white hover:brightness-110"
    >
      {label}
      <ExternalLink className="size-4" aria-hidden />
    </a>
  );
}

export function TelegramLink({ channel: initial }: { channel: ChannelDTO }) {
  const key = `/api/channels/${initial.id}`;
  const [waitingFor, setWaitingFor] = useState<Purpose | null>(initial.telegram?.chatLinked ? null : "main");
  const query = useQuery<ChannelDTO>(key, { interval: waitingFor ? 2000 : undefined });
  const channel = query.data ?? initial;
  const telegram = channel.telegram;
  const [links, setLinks] = useState<Partial<Record<Purpose, LinkDTO>>>({});
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const fetchLink = useCallback(
    async (purpose: Purpose) => {
      setError(null);
      try {
        const link = await api.post<LinkDTO>(`/api/channels/${initial.id}/telegram/link`, { purpose });
        setLinks((current) => ({ ...current, [purpose]: link }));
      } catch (caught) {
        setError(errorMessage(caught));
      }
    },
    [initial.id],
  );

  useEffect(() => {
    if (!initial.telegram?.chatLinked) void fetchLink("main");
  }, [initial.telegram?.chatLinked, fetchLink]);

  useEffect(() => {
    const done = waitingFor === "main" ? telegram?.chatLinked : telegram?.topicsMode === "group";
    if (waitingFor && done) {
      setWaitingFor(null);
      invalidate("/api/channels");
      void fetchQuery("/api/me");
    }
  }, [waitingFor, telegram?.chatLinked, telegram?.topicsMode]);

  async function checkAgain() {
    setChecking(true);
    try {
      setQueryData(key, await api.patch<ChannelDTO>(key, { config: {} }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setChecking(false);
    }
  }

  async function startGroup() {
    setWaitingFor("topics");
    await fetchLink("topics");
  }

  if (!telegram?.chatLinked) {
    return (
      <div className="space-y-3">
        <h3 className="font-semibold">{copy.telegram.linkTitle}</h3>
        <p className="text-sm text-muted">{copy.telegram.linkBody}</p>
        {links.main ? <OpenTelegram link={links.main} label="Open Telegram" /> : !error && <Button className="w-full" busy disabled>Wait</Button>}
        {error && <ErrorBox error={error} onRetry={() => void fetchLink("main")} />}
        <p className="flex items-center gap-2 text-sm text-muted" role="status">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          {copy.telegram.waiting}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm">
        <CircleCheck className="size-5 text-ok" aria-hidden />
        <span>
          {copy.telegram.linked} <strong>{telegram.chatTitle ?? "your chat"}</strong>
          {telegram.botUsername && <span className="text-muted"> with @{telegram.botUsername}</span>}
        </span>
      </p>
      {telegram.topicsMode === "private" && <p className="rounded-xl bg-raised px-3 py-2.5 text-sm">{copy.telegram.topicsPrivate}</p>}
      {telegram.topicsMode === "group" && (
        <p className="flex items-center gap-2 rounded-xl bg-raised px-3 py-2.5 text-sm">
          <Users className="size-4 shrink-0" aria-hidden />
          <span>
            {copy.telegram.topicsGroup} <strong>{telegram.topicsChatTitle ?? "you selected"}</strong>.
          </span>
        </p>
      )}
      {telegram.topicsMode === "off" && (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="text-sm font-medium">{copy.telegram.topicsOff}</p>
          <p className="text-sm text-muted">{copy.telegram.topicsOptionA}</p>
          <Button small busy={checking} onClick={() => void checkAgain()}>
            {!checking && <RefreshCw className="size-4" aria-hidden />}
            Check again
          </Button>
          <p className="text-sm text-muted">{copy.telegram.topicsOptionB}</p>
          {waitingFor === "topics" && links.topics ? (
            <>
              <OpenTelegram link={links.topics} label="Select a group in Telegram" />
              <p className="flex items-center gap-2 text-sm text-muted" role="status">
                <LoaderCircle className="size-4 animate-spin" aria-hidden />
                Beep Me waits for the bot to join a group…
              </p>
            </>
          ) : (
            <Button small onClick={() => void startGroup()}>
              <Users className="size-4" aria-hidden />
              Use a group instead
            </Button>
          )}
        </div>
      )}
      {error && <ErrorBox error={error} />}
    </div>
  );
}
