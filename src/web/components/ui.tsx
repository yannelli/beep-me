import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import type { Priority } from "../../shared/priority";
import { PRIORITY_INFO } from "../../shared/priority";
import { hashHue, initials } from "../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:brightness-110",
  secondary: "border border-line bg-raised text-fg hover:border-muted/60",
  ghost: "text-fg hover:bg-raised",
  danger: "border border-danger/40 bg-danger/10 text-danger hover:bg-danger/20",
};

export function Button({
  variant = "secondary",
  busy,
  small,
  className = "",
  children,
  disabled,
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; busy?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-medium transition-[filter,background-color,border-color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${small ? "px-3 text-sm" : "px-4 text-[15px]"} ${variants[variant]} ${className}`}
      {...rest}
    >
      {busy && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Card({ children, className = "", title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface ${className}`}>
      {title && (
        <header className="flex min-h-12 items-center justify-between gap-3 px-4 pt-3">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={title ? "px-4 pt-1 pb-4" : "p-4"}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-raised ${className}`} aria-hidden />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-16" />
      ))}
    </div>
  );
}

const priorityStyles: Record<Priority, string> = {
  urgent: "bg-rose-500/15 text-rose-500 border-rose-500/30",
  high: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  medium: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30",
  low: "bg-zinc-500/15 text-muted border-zinc-500/30",
};

export const priorityDot: Record<Priority, string> = {
  urgent: "bg-rose-500",
  high: "bg-amber-500",
  medium: "bg-sky-500",
  low: "bg-zinc-400",
};

export function PriorityChip({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${priorityStyles[priority]}`}>
      <span className={`size-1.5 rounded-full ${priorityDot[priority]}`} aria-hidden />
      {PRIORITY_INFO[priority].label}
    </span>
  );
}

export type Tone = "ok" | "warn" | "error" | "neutral" | "accent";

const toneStyles: Record<Tone, string> = {
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  error: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  neutral: "bg-zinc-500/15 text-muted",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${toneStyles[tone]}`}>{children}</span>;
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const hue = hashHue(name);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${hue} 55% 42%)` }}
    >
      {initials(name)}
    </span>
  );
}

export function BrandDot({ color, size = 36, children }: { color: string; size?: number; children?: ReactNode }) {
  return (
    <span aria-hidden className="grid shrink-0 place-items-center rounded-xl text-white" style={{ width: size, height: size, background: color }}>
      {children}
    </span>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
      <span className="min-w-0 break-words">{error}</span>
      {onRetry && (
        <Button small variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
