import { BookOpen, ExternalLink } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { ChannelDTO } from "../../../shared/api";
import { CHANNEL_CATALOG } from "../../../shared/channel-catalog";
import type { ChannelField, ChannelKind } from "../../../shared/channels";
import { SelectField, TextField, ToggleRow } from "../../components/form";
import { Button } from "../../components/ui";
import { copy } from "../../copy";
import { Link } from "../../lib/router";

type Value = string | boolean;
type Values = Record<string, Value>;

const inputTypes: Partial<Record<ChannelField["type"], string>> = { secret: "password", phone: "tel", email: "email", url: "url", number: "number" };

function initialValues(kind: ChannelKind, channel: ChannelDTO | undefined, preset: Values): Values {
  const values: Values = {};
  for (const field of CHANNEL_CATALOG[kind].fields) {
    const stored = channel?.config[field.key];
    if (field.type === "secret") values[field.key] = "";
    else if (stored !== undefined && stored !== null) values[field.key] = typeof stored === "boolean" ? stored : String(stored);
    else if (field.defaultValue !== undefined) values[field.key] = typeof field.defaultValue === "boolean" ? field.defaultValue : String(field.defaultValue);
    else values[field.key] = field.type === "toggle" ? false : "";
  }
  return { ...values, ...preset };
}

function visible(field: ChannelField, values: Values) {
  return !field.showWhen || values[field.showWhen.key] === field.showWhen.equals;
}

export function ChannelForm({
  kind,
  channel,
  preset = {},
  hidden = [],
  busy,
  errors = {},
  submitLabel,
  onSubmit,
}: {
  kind: ChannelKind;
  channel?: ChannelDTO;
  preset?: Values;
  hidden?: string[];
  busy?: boolean;
  errors?: Record<string, string>;
  submitLabel: string;
  onSubmit: (body: { name: string; config: Record<string, unknown> }) => void;
}) {
  const info = CHANNEL_CATALOG[kind];
  const [name, setName] = useState(channel?.name ?? info.name);
  const [values, setValues] = useState(() => initialValues(kind, channel, preset));
  const [missing, setMissing] = useState<Record<string, string>>({});
  const fields = info.fields.filter((field) => visible(field, values));

  function set(key: string, value: Value) {
    const next = { ...values, [key]: value };
    if (kind === "smtp" && key === "security") next.port = value === "starttls" ? "587" : "465";
    setValues(next);
    setMissing((current) => ({ ...current, [key]: "" }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const config: Record<string, unknown> = {};
    const problems: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.key];
      const savedSecret = field.type === "secret" && channel?.secrets[field.key]?.set;
      if (field.type === "secret" && value === "" && channel) continue;
      if (field.required && value === "" && !savedSecret) problems[field.key] = "Fill in this field.";
      config[field.key] = field.type === "number" && value !== "" ? Number(value) : value;
    }
    for (const key of hidden) if (values[key] !== undefined) config[key] = values[key];
    setMissing(problems);
    if (Object.keys(problems).length === 0) onSubmit({ name: name.trim() || info.name, config });
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} error={errors.name} autoComplete="off" />
      {fields
        .filter((field) => !hidden.includes(field.key))
        .map((field) => {
          const error = missing[field.key] || errors[field.key];
          const value = values[field.key];
          if (field.type === "toggle") {
            return <ToggleRow key={field.key} title={field.label} body={field.help} checked={value === true} onChange={(next) => set(field.key, next)} />;
          }
          if (field.type === "select") {
            return (
              <SelectField key={field.key} label={field.label} help={field.help} error={error} value={String(value)} onChange={(event) => set(field.key, event.target.value)}>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
            );
          }
          const secret = channel?.secrets[field.key];
          const saved = field.type === "secret" && secret?.set;
          return (
            <TextField
              key={field.key}
              label={
                <>
                  {field.label}
                  {!field.required && <span className="font-normal text-muted"> (optional)</span>}
                </>
              }
              type={inputTypes[field.type] ?? "text"}
              inputMode={field.type === "number" ? "numeric" : undefined}
              value={String(value)}
              onChange={(event) => set(field.key, event.target.value)}
              placeholder={saved ? `Saved …${secret.hint ?? ""}` : field.placeholder?.replace(/^Optional\.?\s*/, "")}
              help={saved ? copy.channels.secretKept : field.help}
              error={error}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          );
        })}
      <div className="flex flex-wrap gap-x-5">
        <a href={info.keysUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent">
          {info.keysLabel}
          <ExternalLink className="size-4" aria-hidden />
        </a>
        <Link href={`/docs/channels/${info.kind}`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-accent">
          <BookOpen className="size-4" aria-hidden />
          {copy.docs.setupGuide}
        </Link>
      </div>
      <Button type="submit" variant="primary" className="w-full" busy={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
