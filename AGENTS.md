# AGENTS.md

Guide for coding agents working in this repo. Product overview: [README.md](README.md). Docs index with dated research notes: [docs/INDEX.md](docs/INDEX.md).

## Commands

| Command | Use |
| --- | --- |
| `bun run dev` | Worker + dashboard on http://localhost:5173 (Vite + workerd). "Continue as developer" signs in on localhost when `DEV_LOGIN=true` in `.dev.vars`. |
| `bun run typecheck` | `tsc -b` for the Worker, dashboard, and Vite config. Must pass with zero errors. Run `bun run types` after you change `wrangler.jsonc`. |
| `bun run build` | Production build into `dist/`. |
| `bun run check:docs` | Checks the docs site pages. Run it after you change `src/web/docs/` or a behavior the docs describe. |

Do not deploy, push, or run CI workflows unless the user asks. Fixture tests are planned after the user's review; do not add a test suite before then.

## Layout and ownership

- `src/shared/`: contracts used by both sides. `api.ts` (DTOs, routes in `docs/api.md`), `channels.ts` + `channel-catalog.ts` (channel kinds and form fields), `channel-configs.ts` (zod schemas for stored channel config), `settings.ts`, `priority.ts`. Change a contract first, then both sides.
- `src/worker/index.ts`: entry. One `OAuthProvider` per origin wraps the Hono app (`app.ts`) and the MCP handler (`mcp/handler.ts`).
- `src/worker/core/`: `notify.ts` is the pipeline (clamp, holds, collapse, rate cap, route, deliver, log). `routing.ts` picks destinations. `deliver.ts` reserves text slots and calls adapters.
- `src/worker/channels/`: one adapter per provider, implementing `types.ts`. Adapters return `{ ok: false, detail }` for provider errors and never put secrets in `detail`.
- `src/worker/db/`: D1 access. `db/migrate.ts` applies `migrations/*.sql` at startup, each once, in order, by schema version. To change the schema, add the next numbered file and list it in `MIGRATIONS`. Never edit a migration that has shipped.
- Replies, choices, reactions, and inbound files are rows in `interactions` (`db/interactions.ts`). Channel hooks call `recordInteraction` with a `providerRef` so webhook retries do not duplicate rows. Agents read them with `get_replies` (`mcp/replies.ts`, `core/replies.ts`).
- `src/web/`: React 19 + Tailwind CSS 4 dashboard. No router or data library; see `src/web/lib/`.
- `src/web/docs/`: the public docs site at `/docs`. Pages are MDX in `content/`, listed in `nav.ts`. Use [docs/docs-site.md](docs/docs-site.md) when you add or edit a page. When you change behavior, update the matching docs page in the same change.

## Rules

- New files stay at or under 300 lines. Comments are at most 2 lines.
- No em dashes in code comments, UI copy, or docs. US spelling. Short, plain sentences in UI copy.
- No new dependencies without asking the user.
- Revocation is checked in D1 on every MCP and REST request. Keep it that way; KV is eventually consistent.
- Text-message caps use one conditional `INSERT ... SELECT ... WHERE (count) < limit RETURNING`. Keep cap checks atomic.
- When you research a platform fact, add it to a dated note under `docs/research/` and list it in `docs/INDEX.md`.
