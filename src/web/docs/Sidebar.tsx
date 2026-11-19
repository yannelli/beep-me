import { Link } from "../lib/router";
import { DOC_SECTIONS, docHref } from "./nav";

export function DocsSidebar({ currentSlug, onNavigate }: { currentSlug: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Docs" className="space-y-6 text-sm">
      {DOC_SECTIONS.map((section) => (
        <div key={section.title}>
          <p className="mb-1.5 px-2 font-semibold">{section.title}</p>
          <ul className="space-y-0.5">
            {section.pages.map((page) => {
              const active = page.slug === currentSlug;
              return (
                <li key={page.slug}>
                  <Link
                    href={docHref(page.slug)}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-9 items-center rounded-lg px-2 transition-colors ${active ? "bg-accent-soft font-medium text-fg" : "text-muted hover:bg-raised hover:text-fg"}`}
                  >
                    {page.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
