import { useEffect, useState } from "react";

export interface TocItem {
  id: string;
  text: string;
  depth: 2 | 3;
}

export function readToc(article: HTMLElement): TocItem[] {
  return [...article.querySelectorAll<HTMLHeadingElement>("h2[id], h3[id]")]
    .filter((heading) => !heading.closest(".docs-steps"))
    .map((heading) => ({ id: heading.id, text: heading.textContent ?? "", depth: heading.tagName === "H2" ? 2 : 3 }));
}

function useActiveHeading(items: TocItem[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const onScroll = () => {
      let current: string | null = items[0]?.id ?? null;
      for (const item of items) {
        const element = document.getElementById(item.id);
        if (element && element.getBoundingClientRect().top < 120) current = item.id;
      }
      setActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items]);
  return active;
}

export function Toc({ items, showTitle = true }: { items: TocItem[]; showTitle?: boolean }) {
  const active = useActiveHeading(items);
  if (!items.length) return null;
  return (
    <nav aria-label="On this page" className="text-sm">
      {showTitle && <p className="mb-2 font-semibold">On this page</p>}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`block py-1 leading-5 transition-colors ${item.depth === 3 ? "pl-3" : ""} ${item.id === active ? "font-medium text-fg" : "text-muted hover:text-fg"}`}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
