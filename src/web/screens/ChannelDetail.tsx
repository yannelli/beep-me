import { ArrowLeft, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { ChannelDTO } from "../../shared/api";
import { CHANNEL_CATALOG } from "../../shared/channel-catalog";
import { ToggleRow } from "../components/form";
import { ConfirmSheet } from "../components/Sheet";
import { Badge, BrandDot, Button, Card, ErrorBox, Skeleton } from "../components/ui";
import { copy } from "../copy";
import { api, errorMessage, fieldErrors } from "../lib/api";
import { dateTime, relativeTime } from "../lib/format";
import { fetchQuery, invalidate, setQueryData, useQuery } from "../lib/query";
import { Link, navigate, useLocation } from "../lib/router";
import { useToast } from "../lib/toast";
import { channelStatus, useChannelToggle } from "./channels/ChannelCard";
import { ChannelForm } from "./channels/ChannelForm";
import { ChannelTests } from "./channels/ChannelTests";
import { TelegramLink } from "./channels/TelegramLink";
import { TelnyxSetup } from "./channels/TelnyxSetup";

function BackLink() {
  return (
    <Link href="/channels" className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-muted hover:text-fg">
      <ArrowLeft className="size-4" aria-hidden />
      Channels
    </Link>
  );
}

function Detail({ channel }: { channel: ChannelDTO }) {
  const info = CHANNEL_CATALOG[channel.kind];
  const status = channelStatus(channel);
  const toast = useToast();
  const { busy: toggling, toggle } = useChannelToggle(channel);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const gmailOAuth = channel.kind === "gmail" && channel.config.mode === "oauth";

  async function save(body: { name: string; config: Record<string, unknown> }) {
    setSaving(true);
    setErrors({});
    try {
      const updated = await api.patch<ChannelDTO>(`/api/channels/${channel.id}`, body);
      setQueryData(`/api/channels/${channel.id}`, updated);
      invalidate("/api/channels");
      setFormKey((key) => key + 1);
      toast("Saved.");
    } catch (error) {
      setErrors(fieldErrors(error));
      toast(errorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await api.del(`/api/channels/${channel.id}`);
      setQueryData<{ items: ChannelDTO[] }>("/api/channels", (list) => ({ items: (list?.items ?? []).filter((item) => item.id !== channel.id) }));
      void fetchQuery("/api/me");
      toast(`${channel.name} deleted.`);
      navigate("/channels");
    } catch (error) {
      toast(errorMessage(error), "error");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <BrandDot color={info.color} size={44}>
          <span className="font-bold">{info.name[0]}</span>
        </BrandDot>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">{channel.name}</h1>
          <p className="text-sm text-muted">
            {info.name} · used {relativeTime(channel.lastUsedAt)}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>

      {channel.statusDetail && <p className="text-sm text-muted">{channel.statusDetail}</p>}
      {channel.lastError && <ErrorBox error={`Last error: ${channel.lastError}`} />}

      <Card>
        <div className="space-y-4">
          <ToggleRow title="Send messages here" body="Turn this off to stop the channel. Beep Me keeps its settings." checked={channel.enabled} onChange={(next) => void toggle(next)} disabled={toggling} />
          {channel.status !== "needs_setup" && <ChannelTests channel={channel} primary />}
        </div>
      </Card>

      {channel.kind === "telegram" && (
        <Card title="Telegram chat">
          <TelegramLink channel={channel} />
        </Card>
      )}

      {channel.kind === "telnyx" && (
        <Card title="Telnyx setup">
          <TelnyxSetup channel={channel} />
        </Card>
      )}

      {gmailOAuth && (
        <Card title="Google account">
          <p className="mb-3 text-sm text-muted">Sends as {String(channel.config.email ?? "your Google account")}.</p>
          <a href={`/auth/gmail/start?channel=${encodeURIComponent(channel.id)}`} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-raised px-4 font-medium">
            Connect Google again
          </a>
        </Card>
      )}

      <Card title="Settings">
        <ChannelForm
          key={formKey}
          kind={channel.kind}
          channel={channel}
          hidden={channel.kind === "gmail" ? ["mode", ...(gmailOAuth ? ["email"] : [])] : []}
          busy={saving}
          errors={errors}
          submitLabel="Save changes"
          onSubmit={(body) => void save(body)}
        />
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <p className="text-sm text-muted">Added {dateTime(channel.createdAt)}</p>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          <Trash2 className="size-4" aria-hidden />
          Delete channel
        </Button>
      </div>

      <ConfirmSheet
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${channel.name}?`}
        body={copy.channels.deleteBody}
        confirmLabel="Delete channel"
        busy={deleting}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

export function ChannelDetail({ id }: { id: string }) {
  const channel = useQuery<ChannelDTO>(`/api/channels/${id}`);
  const { search } = useLocation();
  const toast = useToast();

  useEffect(() => {
    if (search.get("connected") !== "1") return;
    toast("Gmail connected. Send a test to check it.");
    navigate(`/channels/${id}`, { replace: true });
    invalidate("/api/channels");
    void fetchQuery("/api/me");
  }, [search, id, toast]);

  return (
    <>
      <BackLink />
      {Boolean(channel.error) && !channel.data && <ErrorBox error={errorMessage(channel.error)} onRetry={() => void channel.refetch()} />}
      {!channel.data && !channel.error && (
        <div className="space-y-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-32" />
          <Skeleton className="h-64" />
        </div>
      )}
      {channel.data && <Detail channel={channel.data} />}
    </>
  );
}
