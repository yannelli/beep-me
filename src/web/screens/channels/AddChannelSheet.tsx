import { ArrowLeft, CircleCheck, KeyRound } from "lucide-react";
import { useState } from "react";
import type { ChannelDTO, MeResponse } from "../../../shared/api";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import type { ChannelCategory, ChannelKind } from "../../../shared/channels";
import { CopyField } from "../../components/form";
import { Sheet } from "../../components/Sheet";
import { BrandDot, Button } from "../../components/ui";
import { copy } from "../../copy";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { randomId } from "../../lib/format";
import { fetchQuery, invalidate, useQuery } from "../../lib/query";
import { useToast } from "../../lib/toast";
import { ChannelForm } from "./ChannelForm";
import { ChannelTests } from "./ChannelTests";
import { TelegramLink } from "./TelegramLink";

type Step = { name: "pick" } | { name: "gmail" } | { name: "form"; kind: ChannelKind } | { name: "created"; channel: ChannelDTO };

const categoryOrder: ChannelCategory[] = ["push", "chat", "sms", "email", "developer"];

function KindTile({ kind, onPick }: { kind: ChannelKind; onPick: () => void }) {
  const info = CHANNEL_CATALOG[kind];
  return (
    <button type="button" onClick={onPick} className="flex min-h-16 items-start gap-3 rounded-xl border border-line p-3 text-left hover:border-accent">
      <BrandDot color={info.color} size={32}>
        <span className="text-sm font-bold">{info.name[0]}</span>
      </BrandDot>
      <span className="min-w-0">
        <span className="block font-medium">{info.name}</span>
        <span className="block text-sm text-muted">{info.tagline}</span>
      </span>
    </button>
  );
}

function GmailChoice({ onAppPassword }: { onAppPassword: () => void }) {
  const me = useQuery<MeResponse>("/api/me");
  return (
    <div className="space-y-3">
      {me.data?.gmailOAuthAvailable && (
        <a href="/auth/gmail/start?channel=new" className="block rounded-xl border border-accent bg-accent-soft p-4 hover:brightness-110">
          <span className="block font-semibold">{copy.channels.gmailGoogle}</span>
          <span className="mt-1 block text-sm text-muted">{copy.channels.gmailGoogleBody}</span>
        </a>
      )}
      <button type="button" onClick={onAppPassword} className="block w-full rounded-xl border border-line p-4 text-left hover:border-accent">
        <span className="flex items-center gap-2 font-semibold">
          <KeyRound className="size-4" aria-hidden />
          {copy.channels.gmailApp}
        </span>
        <span className="mt-1 block text-sm text-muted">{copy.channels.gmailAppBody}</span>
      </button>
    </div>
  );
}

function Created({ channel, onDone }: { channel: ChannelDTO; onDone: () => void }) {
  const live = useQuery<ChannelDTO>(channel.kind === "telegram" ? `/api/channels/${channel.id}` : null);
  if (channel.kind === "telegram") {
    return (
      <div className="space-y-5">
        <TelegramLink channel={channel} />
        {live.data?.telegram?.chatLinked && <ChannelTests channel={live.data} primary />}
        <Button className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 font-semibold">
        <CircleCheck className="size-5 text-ok" aria-hidden />
        {copy.channels.createdTitle}
      </p>
      {channel.kind === "ntfy" && (
        <div className="space-y-2">
          <p className="text-sm text-muted">{copy.channels.ntfyNote}</p>
          <CopyField value={String(channel.config.topic ?? "")} label="topic" />
        </div>
      )}
      <p className="text-sm text-muted">{copy.channels.createdBody}</p>
      <ChannelTests channel={channel} primary />
      <Button className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

export function AddChannelSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ name: "pick" });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const toast = useToast();

  function close() {
    onClose();
    window.setTimeout(() => setStep({ name: "pick" }), 200);
    setErrors({});
  }

  function pick(kind: ChannelKind) {
    setErrors({});
    setStep(kind === "gmail" ? { name: "gmail" } : { name: "form", kind });
  }

  async function create(kind: ChannelKind, body: { name: string; config: Record<string, unknown> }) {
    setBusy(true);
    try {
      const channel = await api.post<ChannelDTO>("/api/channels", { kind, ...body });
      setStep({ name: "created", channel });
      invalidate("/api/channels");
      void fetchQuery("/api/me");
    } catch (error) {
      setErrors(fieldErrors(error));
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  }

  const title =
    step.name === "pick" ? "Add channel" : step.name === "gmail" ? "Gmail" : step.name === "form" ? CHANNEL_CATALOG[step.kind].name : step.channel.name;
  const back = step.name === "gmail" || (step.name === "form" && step.kind !== "gmail") ? { name: "pick" as const } : step.name === "form" ? { name: "gmail" as const } : null;

  return (
    <Sheet open={open} onClose={close} title={title}>
      {back && (
        <button type="button" onClick={() => setStep(back)} className="-mt-2 mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </button>
      )}
      {step.name === "pick" && (
        <div className="space-y-5">
          {categoryOrder.map((category) => {
            const kinds = Object.values(CHANNEL_CATALOG).filter((info) => info.category === category);
            return (
              <section key={category}>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{copy.channels.categories[category]}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {kinds.map((info) => (
                    <KindTile key={info.kind} kind={info.kind} onPick={() => pick(info.kind)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {step.name === "gmail" && <GmailChoice onAppPassword={() => setStep({ name: "form", kind: "gmail" })} />}
      {step.name === "form" && (
        <div className="space-y-4">
          <ChannelForm
            key={step.kind}
            kind={step.kind}
            preset={step.kind === "ntfy" ? { topic: `beep-me-${randomId(10)}` } : step.kind === "gmail" ? { mode: "app_password" } : {}}
            hidden={step.kind === "gmail" ? ["mode"] : []}
            busy={busy}
            errors={errors}
            submitLabel={step.kind === "telegram" ? "Next" : "Add channel"}
            onSubmit={(body) => void create(step.kind, body)}
          />
        </div>
      )}
      {step.name === "created" && <Created channel={step.channel} onDone={close} />}
    </Sheet>
  );
}
