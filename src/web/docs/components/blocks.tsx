import { ArrowRight, Info, Lightbulb, TriangleAlert } from "lucide-react";
import { Children, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "../../lib/router";

const callouts = {
  note: { icon: Info, className: "border-sky-500/30 bg-sky-500/5", iconClass: "text-sky-500" },
  tip: { icon: Lightbulb, className: "border-emerald-500/30 bg-emerald-500/5", iconClass: "text-emerald-500" },
  warning: { icon: TriangleAlert, className: "border-amber-500/40 bg-amber-500/5", iconClass: "text-amber-500" },
};

export function Callout({ type = "note", title, children }: { type?: keyof typeof callouts; title?: string; children: ReactNode }) {
  const style = callouts[type] ?? callouts.note;
  return (
    <div className={`docs-callout my-6 flex gap-3 rounded-xl border px-4 py-3 ${style.className}`}>
      <style.icon className={`mt-0.5 size-5 shrink-0 ${style.iconClass}`} aria-hidden />
      <div className="min-w-0 text-[15px] leading-7">
        {title && <p className="font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <div className="docs-steps my-8">{children}</div>;
}

export function Tab({ children }: { label: string; children: ReactNode }) {
  return <>{children}</>;
}

export function Tabs({ children }: { children: ReactNode }) {
  const tabs = Children.toArray(children).filter((child): child is ReactElement<{ label: string; children: ReactNode }> => isValidElement(child));
  const [active, setActive] = useState(0);
  const id = useId();
  return (
    <div className="my-6">
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab, index) => (
          <button
            key={tab.props.label}
            type="button"
            role="tab"
            id={`${id}-tab-${index}`}
            aria-selected={index === active}
            aria-controls={`${id}-panel-${index}`}
            onClick={() => setActive(index)}
            className={`-mb-px min-h-10 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors ${index === active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {tab.props.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div key={tab.props.label} role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} hidden={index !== active} className="docs-tabpanel">
          {tab.props.children}
        </div>
      ))}
    </div>
  );
}

export function Cards({ children }: { children: ReactNode }) {
  return <div className="my-6 grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function Card({ href, title, children }: { href: string; title: string; children?: ReactNode }) {
  return (
    <Link href={href} className="group rounded-xl border border-line bg-surface p-4 transition-colors hover:border-muted/60 hover:bg-raised">
      <span className="flex items-center justify-between gap-2 font-semibold">
        {title}
        <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
      {children && <span className="mt-1 block text-sm leading-6 text-muted">{children}</span>}
    </Link>
  );
}
