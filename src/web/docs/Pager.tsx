import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "../lib/router";
import { DOC_PAGES, docHref } from "./nav";

export function Pager({ slug }: { slug: string }) {
  const index = DOC_PAGES.findIndex((page) => page.slug === slug);
  const previous = DOC_PAGES[index - 1];
  const next = DOC_PAGES[index + 1];
  return (
    <nav aria-label="Previous and next page" className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
      {previous ? (
        <Link href={docHref(previous.slug)} className="group rounded-xl border border-line p-4 transition-colors hover:bg-raised">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <ArrowLeft className="size-3.5" aria-hidden /> Previous
          </span>
          <span className="mt-1 block font-medium">{previous.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={docHref(next.slug)} className="group rounded-xl border border-line p-4 text-right transition-colors hover:bg-raised">
          <span className="flex items-center justify-end gap-1.5 text-xs text-muted">
            Next <ArrowRight className="size-3.5" aria-hidden />
          </span>
          <span className="mt-1 block font-medium">{next.title}</span>
        </Link>
      )}
    </nav>
  );
}
