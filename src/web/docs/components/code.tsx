import { Check, Copy } from "lucide-react";
import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { useCopy } from "../../components/form";
import { ORIGIN_TOKEN, withOrigin } from "../origin";

function replaceOriginText(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.includes(ORIGIN_TOKEN)) node.nodeValue = withOrigin(node.nodeValue);
  }
}

export function Pre({ children, className = "", style, ...rest }: ComponentProps<"pre"> & { "data-title"?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const { copied, copy } = useCopy();
  const title = rest["data-title"];
  useLayoutEffect(() => {
    if (ref.current) replaceOriginText(ref.current);
  });
  return (
    <figure className="docs-code group relative my-6 overflow-hidden rounded-xl border border-line bg-surface">
      {title && <figcaption className="border-b border-line px-4 py-2 font-mono text-xs text-muted">{title}</figcaption>}
      <pre ref={ref} className={`overflow-x-auto py-4 pr-14 pl-4 font-mono text-[13px] leading-6 ${className}`} style={style} tabIndex={0}>
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void copy(ref.current?.innerText.replace(/\n$/, "") ?? "")}
        className={`absolute right-2 grid size-9 place-items-center rounded-lg border border-line bg-raised text-muted opacity-100 transition-opacity hover:text-fg sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 ${title ? "top-11" : "top-2"}`}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </figure>
  );
}

export function InlineCode({ children, ...rest }: ComponentProps<"code">) {
  return <code {...rest}>{typeof children === "string" ? withOrigin(children) : children}</code>;
}
