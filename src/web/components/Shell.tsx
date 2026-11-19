import { BellRing, BookOpen, Bot, Inbox, RadioTower, Route, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { MeResponse } from "../../shared/api";
import { copy } from "../copy";
import { useQuery } from "../lib/query";
import { Link, useLocation } from "../lib/router";

const tabs = [
  { href: "/", label: copy.nav.activity, icon: Inbox },
  { href: "/channels", label: copy.nav.channels, icon: RadioTower },
  { href: "/agents", label: copy.nav.agents, icon: Bot },
  { href: "/routing", label: copy.nav.routing, icon: Route },
  { href: "/settings", label: copy.nav.settings, icon: Settings },
];

function isActive(href: string, path: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[28%] bg-accent text-white" style={{ width: size, height: size }} aria-hidden>
      <BellRing style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.25} />
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const me = useQuery<MeResponse>("/api/me");

  return (
    <div className="min-h-dvh">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 rounded-xl px-2 py-1">
          <Logo />
          <span className="text-lg font-bold tracking-tight">{copy.brand.name}</span>
        </Link>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {tabs.map((tab) => {
            const active = isActive(tab.href, path);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors duration-150 ${active ? "bg-accent-soft text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
              >
                <tab.icon className={`size-5 ${active ? "text-accent" : ""}`} aria-hidden />
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <Link href="/docs" className="mt-auto flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-muted transition-colors duration-150 hover:bg-raised hover:text-fg">
          <BookOpen className="size-5" aria-hidden />
          {copy.docs.link}
        </Link>
        {me.data && (
          <div className="mt-2 flex items-center gap-3 rounded-xl px-2 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium">{me.data.user.name ?? me.data.user.email}</span>
              <span className="block truncate text-muted">{me.data.user.email}</span>
            </span>
          </div>
        )}
      </aside>

      <main className="pt-safe pb-tabbar md:pb-12 md:pl-60">
        <div className="mx-auto w-full max-w-3xl px-4 pt-5 md:px-8 md:pt-10">{children}</div>
      </main>

      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 backdrop-blur-xl md:hidden"
      >
        <div className="flex">
          {tabs.map((tab) => {
            const active = isActive(tab.href, path);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <tab.icon className="size-6" aria-hidden strokeWidth={active ? 2.25 : 1.75} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
