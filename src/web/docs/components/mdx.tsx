import { Link as LinkIcon } from "lucide-react";
import type { MDXComponents } from "mdx/types";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { Link } from "../../lib/router";
import { Callout, Card, Cards, Steps, Tab, Tabs } from "./blocks";
import { InlineCode, Pre } from "./code";
import { ChannelFields, ChannelTable, PriorityTable } from "./data";

function Heading({ as: Tag, id, children, ...rest }: ComponentProps<"h2"> & { as: "h2" | "h3" }) {
  return (
    <Tag id={id} className="group" {...rest}>
      {children}
      {id && (
        <a href={`#${id}`} className="ml-2 inline-block align-middle text-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label="Link to this section">
          <LinkIcon className="size-4" aria-hidden />
        </a>
      )}
    </Tag>
  );
}

function Anchor({ href = "", children, ...rest }: ComponentProps<"a">) {
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
  if (href.startsWith("/")) return <Link href={href} {...rest}>{children}</Link>;
  return <a href={href} {...rest}>{children}</a>;
}

function TableFrame({ children }: { children: ReactNode }) {
  return <div className="docs-table my-6 overflow-x-auto rounded-xl border border-line">{children}</div>;
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : "";
}

type Parent = ReactElement<{ children?: ReactNode }>;
const elements = (node: ReactNode) => Children.toArray(node).filter((child): child is Parent => isValidElement(child));

/** Adds each column header as data-label on its cells, so phones can show rows as labeled blocks. */
function Table({ children, ...rest }: ComponentProps<"table">) {
  const sections = elements(children);
  const headRow = elements(sections.find((section) => section.type === "thead")?.props.children)[0];
  const labels = elements(headRow?.props.children).map((cell) => textOf(cell.props.children));
  const labeled = sections.map((section) =>
    section.type !== "tbody"
      ? section
      : cloneElement(section, {
          children: elements(section.props.children).map((row) =>
            cloneElement(row, { children: elements(row.props.children).map((cell, index) => (index ? cloneElement(cell, { "data-label": labels[index] } as object) : cell)) }),
          ),
        }),
  );
  return (
    <TableFrame>
      <table className="docs-stack" {...rest}>
        {labeled}
      </table>
    </TableFrame>
  );
}

export const mdxComponents: MDXComponents = {
  h2: (props) => <Heading as="h2" {...props} />,
  h3: (props) => <Heading as="h3" {...props} />,
  a: Anchor,
  pre: Pre as MDXComponents["pre"],
  code: InlineCode,
  table: Table,
  Callout,
  Steps,
  Tabs,
  Tab,
  Cards,
  Card,
  ChannelFields: (props: ComponentProps<typeof ChannelFields>) => (
    <TableFrame>
      <ChannelFields {...props} />
    </TableFrame>
  ),
  ChannelTable: () => (
    <TableFrame>
      <ChannelTable />
    </TableFrame>
  ),
  PriorityTable: () => (
    <TableFrame>
      <PriorityTable />
    </TableFrame>
  ),
};
