# Writing the docs site

Created: 2026-11-18. Last updated: 2026-11-18.

The docs site is part of the dashboard app. It is public at `/docs` on every Beep Me deployment, so readers do not need to sign in. Pages are MDX files compiled at build time.

## Files

| Path | What it holds |
| --- | --- |
| `src/web/docs/nav.ts` | The sidebar. Each page's slug, title, and one-sentence description. The page title and description come from here. |
| `src/web/docs/content/<slug>.mdx` | One page. The `/docs` home page is `content/index.mdx`. `/docs/channels/telegram` is `content/channels/telegram.mdx`. |
| `src/web/docs/components/` | The components that MDX pages can use. |
| `scripts/check-docs.mjs` | `bun run check:docs`. Finds missing pages, unknown components, dashes, and broken links. |

To add a page: add it to `nav.ts`, create the MDX file, and run `bun run check:docs`.

## Page shape

- Do not write a `#` heading, frontmatter, or `export const meta`. The site shows the title and description from `nav.ts` above the page.
- Start with one short paragraph that says what the page helps the reader do.
- Use `##` for sections and `###` for subsections. Both appear in the "On this page" list. Use sentence case: "Connect a forum group".
- End task pages with a "Next steps" section that uses `<Cards>`, when there is an obvious next page.

## Components

Use these without an import.

| Component | Use |
| --- | --- |
| `<Callout type="note">` | A fact the reader must not miss. Types: `note`, `tip`, `warning`. Optional `title="..."`. |
| `<Steps>` | A procedure. Write each step as a `###` heading inside `<Steps>`. The site numbers them. |
| `<Tabs>` with `<Tab label="...">` | The same task done in different ways, for example `curl` and GitHub Actions. |
| `<Cards>` with `<Card href="/docs/..." title="...">` | Links to the next pages. Put one sentence inside each card. |
| `<ChannelFields kind="twilio" />` | The form fields for a channel, read from `src/shared/channel-catalog.ts`. |
| `<ChannelTable />` | All channels with their type, topic threads, and silent delivery. |
| `<PriorityTable />` | The four priorities, when to use each, and the default route. |

Leave a blank line after an opening component tag and before the closing tag, so the Markdown inside renders.

```mdx
<Steps>

### Create a bot

Open @BotFather in Telegram and send `/newbot`.

### Paste the token

In Beep Me, open **Channels** and select **Add channel**.

</Steps>
```

## Code

- Every fenced block needs a language: `sh`, `json`, `jsonc`, `ts`, `js`, `http`, `yaml`, `text`, and a few more (see `LANGS` in `scripts/check-docs.mjs`).
- Add a file name with `title`: ```` ```jsonc title="wrangler.jsonc" ````.
- Each block gets a copy button.
- Write the deployment address as `https://your-beep-me.example`. The site replaces it with the address the reader is on, in code blocks and inline code.
- Write agent tokens as `$BEEPME_TOKEN` in shell examples.

## Links

- Docs pages: `/docs/routing/quiet-hours`, with an optional `#heading-id`. Heading ids are the lowercase heading text with dashes, for example `## Text cap` is `#text-cap`.
- Dashboard screens: `/channels`, `/agents`, `/routing`, `/settings`.
- Other sites: full `https://` URLs. They open in a new tab.

## Writing rules

- US English. Second person ("you"). Present tense. Active voice.
- One instruction per sentence. Instructions use the imperative: "Select **Add channel**."
- Sentences: 20 words or fewer for instructions, 25 or fewer for descriptions. Paragraphs: 6 sentences or fewer.
- Name buttons and fields exactly as the dashboard shows them, in bold. Check `src/web/copy.ts` and `src/shared/channel-catalog.ts`.
- Use one term for one thing: agent, channel, priority, topic, route, rule, quiet hours, text cap, message cap, collapse.
- No em dashes or en dashes. No filler words such as "simply", "just", or "easy". No hedging and no hype.
- Write only what the code does. When a fact comes from a provider's docs, link to the source.
- Run the `humanizer` and `ste100-writer` skills on new pages.

## How it is built

Checked on 2026-11-18 against the installed packages.

- `vite.config.ts` compiles MDX with `@mdx-js/rollup` 3.1.1, `remark-gfm` 4 (tables), `rehype-slug` 6 (heading ids, same rules as GitHub), and `@shikijs/rehype` 4.6 (highlighting at build time, `github-light` and `github-dark` as CSS variables).
- The MDX plugin removes the query from module ids, so it would also compile `?raw` imports. The `docsMdx` wrapper in `vite.config.ts` skips them. Search and "Copy page as Markdown" load the raw MDX with `?raw`.
- Each page is its own chunk, loaded by `src/web/docs/content-index.ts`. The dashboard bundle does not include the docs.
- shadcn's own docs use Fumadocs, which needs Next.js, Waku, React Router, or TanStack Router. Beep Me has none of those, so the site copies the three-column shadcn docs layout with the dashboard's own components.
