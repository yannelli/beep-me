import { Check, Copy } from "lucide-react";
import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { useToast } from "../lib/toast";

const control =
  "min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-[16px] text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none focus-visible:outline-2 aria-invalid:border-danger";

export function Field({ label, help, error, children, id }: { label: ReactNode; help?: ReactNode; error?: string; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : (
        help && (
          <p id={`${id}-help`} className="text-sm text-muted">
            {help}
          </p>
        )
      )}
    </div>
  );
}

export function FieldGroup({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <p id={id} className="text-sm font-medium">
        {label}
      </p>
      {children}
      {help && <p className="text-sm text-muted">{help}</p>}
    </div>
  );
}

export function TextField({
  label,
  help,
  error,
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; help?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error}>
      <input
        id={id}
        className={`${control} ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : help ? `${id}-help` : undefined}
        {...rest}
      />
    </Field>
  );
}

export function SelectField({
  label,
  help,
  error,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: ReactNode; help?: ReactNode; error?: string }) {
  const id = useId();
  return (
    <Field id={id} label={label} help={help} error={error}>
      <select id={id} className={`${control} appearance-auto`} aria-invalid={error ? true : undefined} {...rest}>
        {children}
      </select>
    </Field>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group -m-1.5 grid min-h-11 min-w-11 shrink-0 place-items-center rounded-full p-1.5 disabled:opacity-50"
    >
      <span className={`flex h-7 w-12 items-center rounded-full p-0.5 transition-colors duration-150 ${checked ? "bg-accent" : "bg-zinc-500/40"}`}>
        <span className={`size-6 rounded-full bg-white shadow transition-transform duration-150 ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

export function ToggleRow({ title, body, checked, onChange, disabled }: { title: string; body?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {body && <p className="text-sm text-muted">{body}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-xl border border-line bg-bg p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-11 flex-1 rounded-lg px-2 text-sm font-medium transition-colors duration-150 ${value === option.value ? "bg-raised text-fg shadow-sm ring-1 ring-line" : "text-muted hover:text-fg"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ChipButton({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors duration-150 ${active ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg"}`}
    >
      {children}
    </button>
  );
}

export function useCopy() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Copy failed. Select the text and copy it yourself.", "error");
    }
  }
  return { copied, copy };
}

export function CopyField({ value, label, multiline }: { value: string; label: string; multiline?: boolean }) {
  const { copied, copy } = useCopy();
  return (
    <div className="flex items-stretch gap-2 rounded-xl border border-line bg-bg p-1.5 pl-3">
      <code className={`min-w-0 flex-1 self-center py-1.5 font-mono text-[13px] ${multiline ? "break-words whitespace-pre-wrap" : "truncate"}`}>{value}</code>
      <button
        type="button"
        onClick={() => void copy(value)}
        className="grid min-h-11 min-w-11 shrink-0 place-items-center self-start rounded-lg bg-raised text-muted hover:text-fg"
        aria-label={copied ? "Copied" : `Copy ${label}`}
      >
        {copied ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
