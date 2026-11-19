import { cloudflare } from "@cloudflare/vite-plugin";
import mdx from "@mdx-js/rollup";
import rehypeShiki from "@shikijs/rehype";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { defineConfig, type Plugin } from "vite";
import { applyOverlay, readOverlay } from "./scripts/cli/overlay.ts";

const codeTitle = (meta: string) => {
  const title = /title="([^"]+)"/.exec(meta)?.[1];
  return title ? { "data-title": title } : undefined;
};

const mdxPlugin = mdx({
  remarkPlugins: [remarkGfm],
  rehypePlugins: [
    rehypeSlug,
    [rehypeShiki, { themes: { light: "github-light", dark: "github-dark" }, defaultColor: false, fallbackLanguage: "text", parseMetaString: codeTitle }],
  ],
}) as Plugin;
const compileMdx = mdxPlugin.transform as Extract<Plugin["transform"], (...args: never[]) => unknown>;

/** The MDX plugin drops the query from module ids, so `?raw` imports (docs search) would compile too. */
const docsMdx: Plugin = {
  ...mdxPlugin,
  enforce: "pre",
  transform(code, id, options) {
    return /[?&]raw\b/.test(id) ? null : compileMdx.call(this, code, id, options);
  },
};

/** Assets answer page loads before the Worker runs, so pages on other hosts move to the primary hostname here. */
function primaryHostRedirect(host: string | undefined): Plugin {
  const script = `if(!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname)&&location.hostname!==${JSON.stringify(host)})location.replace("https://${host}"+location.pathname+location.search+location.hash)`;
  return { name: "beep-me-primary-host", transformIndexHtml: () => (host ? [{ tag: "script", children: script, injectTo: "head-prepend" }] : []) };
}

/** Builds read the gitignored deploy overlay. Dev skips it, so local D1 and KV state stays under the binding names. */
export default defineConfig(({ command }) => {
  const overlay = command === "build" ? readOverlay(fileURLToPath(new URL(".", import.meta.url))) : {};
  return {
    plugins: [docsMdx, react(), tailwindcss(), primaryHostRedirect(overlay.domain), cloudflare({ config: (config) => applyOverlay(config, overlay) })],
  };
});
