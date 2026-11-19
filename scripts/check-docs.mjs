#!/usr/bin/env node
// Checks the docs site: every page in nav.ts has an MDX file, MDX compiles, components and links resolve.
// Optional argument: a path under src/web/docs/content to limit the report, for example `channels`.
import { compile } from "@mdx-js/mdx";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

const CONTENT = "src/web/docs/content";
const COMPONENTS = new Set(["Callout", "Steps", "Tabs", "Tab", "Cards", "Card", "ChannelFields", "ChannelTable", "PriorityTable"]);
const LANGS = new Set(["sh", "bash", "json", "jsonc", "ts", "tsx", "js", "http", "yaml", "text", "toml", "html", "diff", "python"]);
const DASHBOARD = ["/channels", "/agents", "/routing", "/settings"];
const CALLOUT_TYPES = new Set(["note", "tip", "warning"]);

const slugs = [...readFileSync("src/web/docs/nav.ts", "utf8").matchAll(/slug: "([^"]*)"/g)].map((match) => match[1]);
const kinds = new Set([...readFileSync("src/shared/channels.ts", "utf8").split("] as const")[0].matchAll(/"(\w+)"/g)].map((match) => match[1]));
const fileFor = (slug) => join(CONTENT, `${slug || "index"}.mdx`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".mdx") ? [path] : [];
  });
}

function visit(node, fn) {
  fn(node);
  for (const child of node.children ?? []) visit(child, fn);
}

const errors = [];
const pages = new Map();
const files = walk(CONTENT);
const expected = new Set(slugs.map(fileFor));

for (const slug of slugs) if (!files.includes(fileFor(slug))) errors.push(`${fileFor(slug)}: missing (listed in nav.ts)`);
for (const file of files) if (!expected.has(file)) errors.push(`${file}: not listed in nav.ts`);

for (const file of files.filter((path) => expected.has(path))) {
  const source = readFileSync(file, "utf8");
  const page = { ids: new Set(), links: [] };
  const report = (message) => errors.push(`${file}: ${message}`);
  if (/^#\s/m.test(source.replace(/```[\s\S]*?```/g, ""))) report("uses a # heading. The page title comes from nav.ts; start sections at ##.");
  for (const [index, line] of source.split("\n").entries()) if (/[–—]/.test(line)) report(`line ${index + 1}: em or en dash`);
  const collect = () => (tree) =>
    visit(tree, (node) => {
      if (node.type === "code" && !LANGS.has(node.lang ?? "")) report(`code block language "${node.lang ?? ""}" is missing or not allowed`);
      if (node.type === "link") page.links.push(node.url);
      if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
        const attrs = Object.fromEntries((node.attributes ?? []).map((attr) => [attr.name, typeof attr.value === "string" ? attr.value : null]));
        if (!COMPONENTS.has(node.name)) report(`unknown component <${node.name}>`);
        if (node.name === "Card" && attrs.href) page.links.push(attrs.href);
        if (node.name === "ChannelFields" && !kinds.has(attrs.kind)) report(`<ChannelFields kind="${attrs.kind}"> is not a channel kind`);
        if (node.name === "Callout" && attrs.type && !CALLOUT_TYPES.has(attrs.type)) report(`<Callout type="${attrs.type}"> is not note, tip, or warning`);
        if (node.name === "Tab" && !attrs.label) report("<Tab> needs a label");
      }
    });
  const ids = () => (tree) => visit(tree, (node) => node.type === "element" && node.properties?.id && page.ids.add(String(node.properties.id)));
  try {
    await compile(source, { remarkPlugins: [remarkGfm, collect], rehypePlugins: [rehypeSlug, ids] });
  } catch (error) {
    report(`does not compile: ${error.message}`);
  }
  pages.set(slugs.find((slug) => fileFor(slug) === file), { ...page, file });
}

for (const [slug, page] of pages) {
  for (const link of page.links) {
    if (/^(https?:|mailto:)/.test(link)) continue;
    const [path, hash] = link.split("#");
    if (!path) {
      if (!page.ids.has(hash)) errors.push(`${page.file}: link #${hash} has no matching heading on this page`);
      continue;
    }
    if (path === "/" || DASHBOARD.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) continue;
    const target = path.startsWith("/docs") ? path.replace(/^\/docs\/?/, "").replace(/\/$/, "") : null;
    if (target === null || !slugs.includes(target)) {
      errors.push(`${page.file}: link ${link} does not match a docs page or dashboard screen`);
      continue;
    }
    if (hash && pages.has(target) && !pages.get(target).ids.has(hash)) errors.push(`${page.file}: link ${link} has no heading #${hash} on ${slug === target ? "this page" : target}`);
  }
}

const only = process.argv[2];
if (only) errors.splice(0, errors.length, ...errors.filter((error) => error.startsWith(join(CONTENT, only))));
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  console.error(`\n${errors.length} problem(s) in ${relative(".", CONTENT)}`);
  process.exit(1);
}
console.log(`Docs OK: ${pages.size} pages, ${[...pages.values()].reduce((sum, page) => sum + page.links.length, 0)} links checked.`);
