import { BookOpen, ExternalLink } from "lucide-react";
import { useState, type FormEvent } from "react";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import type { TelnyxAccountDTO, TelnyxNumberDTO } from "../../../shared/telnyx-setup";
import { FieldGroup, TextField } from "../../components/form";
import { Button, ErrorBox } from "../../components/ui";
import { copy } from "../../copy";
import { api, errorMessage, fieldErrors } from "../../lib/api";
import { Link } from "../../lib/router";

const info = CHANNEL_CATALOG.telnyx;

export function numberType(number: TelnyxNumberDTO): string {
  if (number.tollFree) return "Toll-free";
  if (/short-?code/.test(number.type ?? "")) return "Short code";
  return "Long code";
}

function NumberOption({ number, profile, checked, onPick }: { number: TelnyxNumberDTO; profile: string | null; checked: boolean; onPick: () => void }) {
  return (
    <label className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border p-3 ${checked ? "border-accent bg-accent-soft" : "border-line hover:border-muted/60"}`}>
      <input type="radio" name="telnyx-number" className="size-4 accent-accent" checked={checked} onChange={onPick} />
      <span className="min-w-0">
        <span className="block font-medium tabular-nums">{number.phoneNumber}</span>
        <span className="block truncate text-sm text-muted">
          {numberType(number)} · {profile ? `Profile "${profile}"` : "No messaging profile"}
        </span>
      </span>
    </label>
  );
}

/** Add flow for Telnyx: paste the API key, pick a number from the account, then enter your mobile number. */
export function TelnyxConnect({
  busy,
  errors,
  onSubmit,
  onManual,
}: {
  busy: boolean;
  errors: Record<string, string>;
  onSubmit: (body: { name: string; config: Record<string, unknown> }) => void;
  onManual: () => void;
}) {
  const [name, setName] = useState(info.name);
  const [apiKey, setApiKey] = useState("");
  const [to, setTo] = useState("");
  const [account, setAccount] = useState<TelnyxAccountDTO | null>(null);
  const [from, setFrom] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<Record<string, string>>({});

  async function findNumbers() {
    if (apiKey.trim().length < 16) return setMissing({ apiKey: "Paste the full API key." });
    setLoading(true);
    setError(null);
    setMissing({});
    try {
      const found = await api.post<TelnyxAccountDTO>("/api/integrations/telnyx/account", { apiKey: apiKey.trim() });
      setAccount(found);
      setFrom(found.numbers.length === 1 ? found.numbers[0]!.phoneNumber : "");
    } catch (caught) {
      setMissing(fieldErrors(caught));
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!account) return void findNumbers();
    const problems: Record<string, string> = {};
    if (!from) problems.from = "Select a number.";
    if (!to.trim()) problems.to = "Fill in this field.";
    setMissing(problems);
    if (Object.keys(problems).length === 0) onSubmit({ name: name.trim() || info.name, config: { apiKey: apiKey.trim(), from, to: to.trim() } });
  }

  const profileName = (id: string | null) => account?.profiles.find((profile) => profile.id === id)?.name ?? null;

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} autoComplete="off" />
      <TextField
        label="API key"
        type="password"
        value={apiKey}
        onChange={(event) => {
          setApiKey(event.target.value);
          setAccount(null);
        }}
        placeholder="KEY…"
        help="Beep Me uses the key to list your numbers and to send texts."
        error={missing.apiKey || errors.apiKey}
        autoComplete="off"
        spellCheck={false}
      />
      {error && <ErrorBox error={error} />}
      {account && account.numbers.length === 0 && (
        <p className="rounded-xl bg-raised px-3 py-2.5 text-sm">This Telnyx account has no numbers that can send texts. Buy a number in the Telnyx portal, then try again.</p>
      )}
      {account && account.numbers.length > 0 && (
        <FieldGroup label="From number">
          <div className="space-y-2">
            {account.numbers.map((number) => (
              <NumberOption key={number.id} number={number} profile={profileName(number.messagingProfileId)} checked={from === number.phoneNumber} onPick={() => setFrom(number.phoneNumber)} />
            ))}
          </div>
          {(missing.from || errors.from) && <p className="text-sm text-danger">{missing.from || errors.from}</p>}
        </FieldGroup>
      )}
      {account && account.numbers.length > 0 && (
        <TextField
          label="Your mobile number"
          type="tel"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="+15557654321"
          help="Use the international format, for example +15551234567."
          error={missing.to || errors.to}
          autoComplete="off"
        />
      )}
      <div className="flex flex-wrap gap-x-5">
        <a href={info.keysUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent">
          {info.keysLabel}
          <ExternalLink className="size-4" aria-hidden />
        </a>
        <Link href="/docs/channels/telnyx" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent">
          <BookOpen className="size-4" aria-hidden />
          {copy.docs.setupGuide}
        </Link>
        <button type="button" onClick={onManual} className="inline-flex min-h-11 items-center text-sm font-medium text-muted hover:text-fg">
          Enter the details yourself
        </button>
      </div>
      {account?.numbers.length !== 0 && (
        <Button type="submit" variant="primary" className="w-full" busy={account ? busy : loading}>
          {account ? "Add channel" : "Find my numbers"}
        </Button>
      )}
    </form>
  );
}
