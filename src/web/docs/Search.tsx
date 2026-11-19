import { FileText, Hash, Search as SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { navigate } from "../lib/router";
import { buildSearchIndex, type SearchEntry } from "./content-index";
import { docHref } from "./nav";

let indexPromise: Promise<SearchEntry[]> | null = null;

const wordStart = (term: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu");

function score(entry: SearchEntry, terms: string[]): number {
  const text = `${entry.page.description} ${entry.text}`;
  let total = 0;
  for (const term of terms) {
    const pattern = wordStart(term);
    const hit = (pattern.test(entry.page.title) ? 10 : 0) + (pattern.test(entry.heading?.text ?? "") ? 6 : 0) + (pattern.test(text) ? 1 : 0);
    if (!hit) return 0;
    total += hit;
  }
  return total + (entry.heading ? 0 : 0.5);
}

function snippet(text: string, term: string): string {
  const at = text.toLowerCase().indexOf(term);
  if (at < 0) return text.slice(0, 110);
  const start = Math.max(0, at - 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 120)}${start + 120 < text.length ? "…" : ""}`;
}

export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]");
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<SearchEntry[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      setQuery("");
      setActive(0);
      indexPromise ??= buildSearchIndex();
      void indexPromise.then(setIndex);
    }
    if (!open && element.open) element.close();
  }, [open]);

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const results = useMemo(() => {
    if (!index || !terms.length) return [];
    return index
      .map((entry) => ({ entry, score: score(entry, terms) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((result) => result.entry);
  }, [index, terms]);

  function go(entry: SearchEntry) {
    onClose();
    navigate(`${docHref(entry.page.slug)}${entry.heading ? `#${entry.heading.id}` : ""}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((value) => (results.length ? (value + step + results.length) % results.length : 0));
    }
    if (event.key === "Enter" && results[active]) go(results[active]);
  }

  return (
    <dialog
      ref={dialog}
      className="docs-search"
      aria-label="Search the docs"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <SearchIcon className="size-4 shrink-0 text-muted" aria-hidden />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search the docs"
          aria-label="Search the docs"
          className="min-h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
        />
        <kbd className="rounded-md border border-line px-1.5 py-0.5 text-xs text-muted">Esc</kbd>
      </div>
      <div className="max-h-[60dvh] overflow-y-auto p-2" role="listbox" aria-label="Results">
        {!terms.length && <p className="px-3 py-6 text-center text-sm text-muted">Type a word, for example "Telegram" or "quiet".</p>}
        {terms.length > 0 && index && !results.length && <p className="px-3 py-6 text-center text-sm text-muted">No pages match "{query}".</p>}
        {terms.length > 0 && !index && <p className="px-3 py-6 text-center text-sm text-muted">Loading the docs.</p>}
        {results.map((entry, position) => (
          <button
            key={`${entry.page.slug}#${entry.heading?.id ?? ""}`}
            type="button"
            role="option"
            aria-selected={position === active}
            onMouseMove={() => setActive(position)}
            onClick={() => go(entry)}
            className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left ${position === active ? "bg-raised" : ""}`}
          >
            {entry.heading ? <Hash className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden /> : <FileText className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {entry.page.title}
                {entry.heading && <span className="text-muted"> › {entry.heading.text}</span>}
              </span>
              <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-muted">{snippet(entry.text || entry.page.description, terms[0]!)}</span>
            </span>
          </button>
        ))}
      </div>
    </dialog>
  );
}
