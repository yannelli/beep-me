import { Check, Copy, LayoutDashboard, Menu, Search, X } from "lucide-react";
import type { MDXContent } from "mdx/types";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Logo } from "../components/Shell";
import { Button, Skeleton } from "../components/ui";
import { useCopy } from "../components/form";
import { Link, NAV_EVENT, useLocation } from "../lib/router";
import { mdxComponents } from "./components/mdx";
import { loadPage, loadSource } from "./content-index";
import { findDocPage, type DocPage } from "./nav";
import { withOrigin } from "./origin";
import { Pager } from "./Pager";
import { SearchDialog, useSearchShortcut } from "./Search";
import { DocsSidebar } from "./Sidebar";
import { readToc, Toc, type TocItem } from "./Toc";
import "./docs.css";

function subscribeHash(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener(NAV_EVENT, listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener(NAV_EVENT, listener);
    window.removeEventListener("popstate", listener);
  };
}

const useHash = () => useSyncExternalStore(subscribeHash, () => location.hash);

type Loaded = { slug: string; Content: MDXContent } | { slug: string; failed: true };

function CopyPage({ slug }: { slug: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button small onClick={() => void loadSource(slug)?.then((source) => copy(withOrigin(source)))}>
      {copied ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "Copied" : "Copy page as Markdown"}
    </Button>
  );
}

function PageBody({ page, onToc }: { page: DocPage; onToc: (items: TocItem[]) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const article = useRef<HTMLElement>(null);
  const hash = useHash();

  useEffect(() => {
    let current = true;
    loadPage(page.slug)
      ?.then((module) => current && setLoaded({ slug: page.slug, Content: module.default }))
      .catch(() => current && setLoaded({ slug: page.slug, failed: true }));
    return () => {
      current = false;
    };
  }, [page.slug]);

  const ready = loaded?.slug === page.slug && "Content" in loaded ? loaded : null;

  useLayoutEffect(() => {
    if (!ready || !article.current) return;
    onToc(readToc(article.current));
  }, [ready, onToc]);

  useEffect(() => {
    if (ready && hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [ready, hash]);

  if (loaded?.slug === page.slug && "failed" in loaded) {
    return <p className="text-muted">This page did not load. Reload the page to try again.</p>;
  }
  if (!ready) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading page">
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  return (
    <article ref={article} className="docs-prose">
      <ready.Content components={mdxComponents} />
    </article>
  );
}

function MobileMenu({ open, onClose, slug }: { open: boolean; onClose: () => void; slug: string | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) element.showModal();
    if (!open && element?.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="docs-drawer"
      aria-label="Docs menu"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex h-14 items-center justify-between border-b border-line px-4">
        <span className="font-semibold">Docs</span>
        <button type="button" onClick={onClose} className="grid size-11 place-items-center rounded-lg text-muted hover:text-fg" aria-label="Close menu">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="overflow-y-auto px-3 py-5">
        <DocsSidebar currentSlug={slug} onNavigate={onClose} />
      </div>
    </dialog>
  );
}

export default function DocsApp() {
  const { path } = useLocation();
  const page = findDocPage(path);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [toc, setToc] = useState<TocItem[]>([]);
  const openSearch = useCallback(() => setSearch(true), []);
  useSearchShortcut(openSearch);

  useEffect(() => {
    document.title = page ? `${page.title} · Beep Me docs` : "Page not found · Beep Me docs";
    setToc([]);
    return () => {
      document.title = "Beep Me";
    };
  }, [page]);

  return (
    <div className="min-h-dvh">
      <header className="pt-safe sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[88rem] items-center gap-2 px-3 sm:px-6">
          <button type="button" onClick={() => setMenu(true)} className="grid size-11 place-items-center rounded-lg text-muted hover:text-fg lg:hidden" aria-label="Open docs menu">
            <Menu className="size-5" aria-hidden />
          </button>
          <Link href="/docs" className="flex items-center gap-2 rounded-lg px-1 py-1">
            <Logo size={28} />
            <span className="font-bold tracking-tight">Beep Me</span>
            <span className="text-muted">Docs</span>
          </Link>
          <div className="flex-1" />
          <button
            type="button"
            onClick={openSearch}
            className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-muted transition-colors hover:text-fg sm:w-64"
            aria-label="Search the docs"
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden flex-1 text-left sm:inline">Search the docs</span>
            <kbd className="hidden rounded border border-line px-1.5 text-[11px] sm:inline">⌘K</kbd>
          </button>
          <Link href="/" className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted hover:bg-raised hover:text-fg">
            <LayoutDashboard className="size-4" aria-hidden />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-[88rem] px-4 sm:px-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 xl:grid-cols-[14rem_minmax(0,1fr)_13rem]">
        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto py-8 pr-1 lg:block">
          <DocsSidebar currentSlug={page?.slug ?? null} />
        </aside>

        <main className="min-w-0 pt-8 pb-16 lg:pt-10">
          <div className="mx-auto max-w-[46rem]">
            {page ? (
              <>
                <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{page.title}</h1>
                <p className="mt-3 text-lg leading-7 text-muted text-pretty">{page.description}</p>
                <div className="mt-5">
                  <CopyPage slug={page.slug} />
                </div>
                {toc.length > 0 && (
                  <details className="mt-6 rounded-xl border border-line px-4 py-3 xl:hidden">
                    <summary className="cursor-pointer text-sm font-medium">On this page</summary>
                    <div className="mt-2">
                      <Toc items={toc} showTitle={false} />
                    </div>
                  </details>
                )}
                <div className="mt-8">
                  <PageBody key={page.slug} page={page} onToc={setToc} />
                </div>
                <Pager slug={page.slug} />
              </>
            ) : (
              <>
                <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
                <p className="mt-3 text-lg text-muted">
                  This page does not exist. Go to the <Link href="/docs" className="text-fg underline underline-offset-4">docs home</Link> or search the docs.
                </p>
              </>
            )}
          </div>
        </main>

        <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto py-10 xl:block">
          <Toc items={toc} />
        </aside>
      </div>

      <MobileMenu open={menu} onClose={() => setMenu(false)} slug={page?.slug ?? null} />
      <SearchDialog open={search} onClose={() => setSearch(false)} />
    </div>
  );
}
