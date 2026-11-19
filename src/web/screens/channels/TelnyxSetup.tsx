import { useState } from "react";
import type { ChannelDTO } from "../../../shared/api";
import type { TelnyxAction, TelnyxPlanDTO, TelnyxSetupDTO } from "../../../shared/telnyx-setup";
import { SelectField, TextField } from "../../components/form";
import { ConfirmSheet } from "../../components/Sheet";
import { Button, ErrorBox, Skeleton } from "../../components/ui";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { invalidate, setQueryData, useQuery } from "../../lib/query";
import { useToast } from "../../lib/toast";
import { numberType } from "./TelnyxConnect";
import { SetupRow, TelnyxRegistration } from "./TelnyxRegistration";

function ProfilePicker({ state, busy, label, onAction }: { state: TelnyxSetupDTO; busy: boolean; label: string; onAction: (action: TelnyxAction) => void }) {
  const [profileId, setProfileId] = useState("");
  const choices = state.profiles.filter((profile) => profile.id !== state.profile?.id);
  if (!choices.length) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <SelectField label={label} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          <option value="">Select a profile</option>
          {choices.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </SelectField>
      </div>
      <Button disabled={!profileId} busy={busy} onClick={() => onAction({ action: "assign_profile", profileId })}>
        Use this profile
      </Button>
    </div>
  );
}

function ProfileRow({ state, busy, onAction }: { state: TelnyxSetupDTO; busy: boolean; onAction: (action: TelnyxAction) => void }) {
  if (state.profile) {
    return (
      <SetupRow ok title={`Messaging profile: ${state.profile.name}`}>
        <ProfilePicker state={state} busy={busy} label="Move to another profile" onAction={onAction} />
      </SetupRow>
    );
  }
  return (
    <SetupRow ok={false} title="This number has no messaging profile. Telnyx needs one to send texts.">
      <ProfilePicker state={state} busy={busy} label="Messaging profile" onAction={onAction} />
      <Button small busy={busy} onClick={() => onAction({ action: "create_profile", name: "Beep Me" })}>
        Create a profile for Beep Me
      </Button>
    </SetupRow>
  );
}

function RepliesRow({ state, busy, onAction }: { state: TelnyxSetupDTO; busy: boolean; onAction: (action: TelnyxAction) => void }) {
  if (!state.profile) return null;
  const current = state.profile.webhookUrl;
  if (current === state.inboundUrl) return <SetupRow ok title="Replies come back to Beep Me." />;
  return (
    <SetupRow ok={false} title={current ? "Replies go to another app." : "Replies are off. The messaging profile has no webhook URL."}>
      {current && <p className="text-sm break-all text-muted">{current}</p>}
      <Button small busy={busy} onClick={() => onAction({ action: "set_webhook" })}>
        Send replies to Beep Me
      </Button>
    </SetupRow>
  );
}

function PublicKeyRow({ channel, state }: { channel: ChannelDTO; state: TelnyxSetupDTO }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  if (state.publicKeySet) return <SetupRow ok title="Public key saved. Beep Me checks the signature of each reply." />;

  async function save() {
    setSaving(true);
    setError(undefined);
    try {
      const updated = await api.patch<ChannelDTO>(`/api/channels/${channel.id}`, { config: { publicKey: value.trim() } });
      setQueryData(`/api/channels/${channel.id}`, updated);
      invalidate(`/api/integrations/telnyx/channels/${channel.id}`);
      toast("Public key saved.");
    } catch (caught) {
      setError(fieldErrors(caught).publicKey ?? errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SetupRow ok={false} title="Add your public key to get replies.">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <TextField
            label="Public key"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            help="Copy it from Keys & Credentials > Public Key in the Telnyx portal."
            error={error}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <Button className="sm:mt-7" disabled={!value.trim()} busy={saving} onClick={() => void save()}>
          Save key
        </Button>
      </div>
    </SetupRow>
  );
}

/** Checks the number, messaging profile, reply webhook, and US registration, and fixes them after a confirm. */
export function TelnyxSetup({ channel }: { channel: ChannelDTO }) {
  const key = `/api/integrations/telnyx/channels/${channel.id}`;
  const query = useQuery<TelnyxSetupDTO>(key);
  const [pending, setPending] = useState<{ action: TelnyxAction; plan: TelnyxPlanDTO } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const state = query.data;

  async function propose(action: TelnyxAction) {
    setBusy(true);
    try {
      setPending({ action, plan: await api.post<TelnyxPlanDTO>(`${key}/plan`, action) });
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      setQueryData(key, await api.post<TelnyxSetupDTO>(`${key}/actions`, { ...pending.action, confirm: true }));
      setPending(null);
      toast("Telnyx updated.");
    } catch (caught) {
      toast(errorMessage(caught), "error");
    } finally {
      setBusy(false);
    }
  }

  if (query.error && !state) return <ErrorBox error={errorMessage(query.error)} onRetry={() => void query.refetch()} />;
  if (!state) return <Skeleton className="h-40" />;
  const onAction = (action: TelnyxAction) => void propose(action);

  return (
    <div className="space-y-4">
      {state.number ? (
        <SetupRow ok title={`${state.number.phoneNumber} (${numberType(state.number)})`} />
      ) : (
        <SetupRow ok={false} title={`Telnyx does not list ${String(channel.config.from)} as a messaging number.`} />
      )}
      {state.number && <ProfileRow state={state} busy={busy} onAction={onAction} />}
      <RepliesRow state={state} busy={busy} onAction={onAction} />
      {!state.inboundReachable && <p className="rounded-xl bg-raised px-3 py-2.5 text-sm">Telnyx can send replies only to an https address. Replies work after you deploy Beep Me.</p>}
      <PublicKeyRow channel={channel} state={state} />
      {state.number && <TelnyxRegistration registration={state.registration} busy={busy} onAction={onAction} />}
      {state.problems.map((problem) => (
        <ErrorBox key={problem} error={problem} />
      ))}
      <ConfirmSheet
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.plan.title ?? ""}
        body="Beep Me makes these changes in your Telnyx account:"
        confirmLabel="Make changes"
        busy={busy}
        onConfirm={() => void confirm()}
      >
        <ul className="list-disc space-y-1.5 pl-5 text-sm break-words">
          {pending?.plan.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </ConfirmSheet>
    </div>
  );
}
