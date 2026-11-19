# CLI, deploy overlay, and custom domains

Created: 2026-11-19. Last updated: 2026-11-19.

Facts that `scripts/cli/` and `vite.config.ts` rely on. Checked against the installed packages: `wrangler` 4.165.0, `@cloudflare/vite-plugin` 1.70.0, `@clack/prompts` 1.9.0, Node.js 24.21, Bun 1.4.4.

## Vite plugin config override

- `cloudflare({ config })` takes a partial Worker config or a function. Source: `node_modules/@cloudflare/vite-plugin/dist/index.d.mts` (`EntryWorkerConfig.config`, `WorkerConfigCustomizer`).
- The plugin merges a returned object with `defu(result, fileConfig)` (`customizeWorkerConfig` in `dist/index.mjs`). `defu` appends arrays, so a returned `d1_databases` entry adds a second binding. `applyOverlay` mutates the config in place and returns nothing.
- `vite build` writes the merged config to `dist/beep_me/wrangler.json` and a redirect file `.wrangler/deploy/config.json`. `wrangler deploy` prints `Using redirected Wrangler configuration` and reads the merged file.
- Local D1 and KV state is keyed by the resource id when one is set. The overlay is applied on `build` only, so `vite dev` keeps its data under the binding names.

## Alias redirects

- `assets.run_worker_first` lists only the Worker routes. Static assets answer every other path (`/`, `/docs`, `/channels`) before the Worker runs, so a Worker redirect cannot move page loads. Checked with `vite preview` and `curl --resolve`: on an alias host, `/api/me` returned 308 and `/` returned 200.
- The Worker returns 308 for Worker routes on other hosts and compares `hostname` (ports differ in local preview). `/hooks/` and `/v1/` stay on every host.
- `vite.config.ts` adds an inline script to `index.html` when `domain` is set. It calls `location.replace` to the primary hostname unless the page is on that hostname or on `localhost`. The repository has no Content Security Policy that blocks inline scripts.
- Putting the Worker in front of page loads needs `run_worker_first: ["/*", "!/assets/*"]` (negative patterns are in the 4.165 schema), an `ASSETS` binding, and a Hono fallback to `env.ASSETS.fetch`. The CLI change does not do this.
- `bun run preview` uses the overlay too, so a local preview build with a domain carries the redirect script and the real ids. On `localhost` the script does nothing.

## Wrangler behavior

- `wrangler whoami --json` returns `loggedIn`, `email`, `accounts[]` (`id`, `name`), and `tokenPermissions`. It exits non-zero when not signed in.
- `wrangler auth token --json` returns `{ "type": "oauth", "token": "..." }`. The CLI uses this token for Cloudflare API reads and never prints it.
- Account precedence (`getActiveAccountId`): `account_id` in the config wins over `CLOUDFLARE_ACCOUNT_ID`. The redirect file makes most commands read the last build's config, so a stale build can pick the account. The CLI passes `--config wrangler.jsonc` to every command except `deploy`.
- Without a terminal, Wrangler needs `CLOUDFLARE_ACCOUNT_ID` or `account_id` when the login has more than one account.
- `wrangler d1 execute <name> --remote` finds the database by name through the API when the config has no `database_id`. Errors print `{ "error": { "text": "..." } }` with `--json`.
- `wrangler d1 create` and `kv namespace create` ask to edit the config only in a terminal. Without one, they answer no. The CLI reads the new id from `d1 list --json` or `kv namespace list`.
- `wrangler secret list --name beep-me` fails with `Worker "beep-me" not found.` before the first deploy. The CLI treats that as "not deployed".
- Automatic provisioning is on by default: `wrangler deploy` creates D1 and KV resources for bindings without ids, named after the Worker. The CLI refuses to deploy until `.beep-me/deploy.json` has both ids. `bun run deploy` has no such check.
- `wrangler delete` asks for confirmation in a terminal. Without one, it uses the fallback answer yes.

## Custom domains

Source: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ (fetched 2026-11-19) and `publishCustomDomains` in `wrangler-dist/cli.js`.

- Config: `routes: [{ "pattern": "beep.example.com", "custom_domain": true }]`. The zone must be active in the same account. Cloudflare creates the DNS record and an Advanced Certificate. Wildcards are not supported. All paths on the hostname go to the Worker.
- Wrangler sends the full list of custom domains with `replace_state=true`, so a domain removed from the config is detached on the next deploy. When the config has no custom domain left, Wrangler skips this call and the old domains stay attached. The CLI detaches them with `DELETE /accounts/{id}/workers/domains/{domain_id}` after a typed confirmation.
- In a terminal, Wrangler asks before it moves a domain from another Worker or replaces conflicting DNS records. Without a terminal, it sets `override_existing_origin` and `override_existing_dns_record` to true and replaces both without a question. For this reason the CLI runs interactive deploys with the terminal attached, and headless deploys first check `GET /accounts/{id}/workers/domains` for hostnames that serve another Worker.

## API access with the Wrangler login

Read-only probes with the OAuth login (scopes include `zone:read`, `workers_routes:write`, `workers:write`; no DNS scope):

| Request | Status |
| --- | --- |
| `GET /zones?account.id={id}` | 200 |
| `GET /accounts/{id}/workers/domains` | 200 |
| `GET /accounts/{id}/workers/subdomain` | 200 |
| `GET /zones/{zone_id}/dns_records` | 403, `Authentication error` |

The CLI lists zones to suggest `beep.<zone>`, checks that a hostname is in one of them, and builds the `workers.dev` URL from the subdomain. To check for DNS conflicts it tries the DNS API (works with an API token that can read DNS) and falls back to a public DNS lookup.

## Prompt library

`@clack/prompts` 1.9.0 (dependencies: `@clack/core`, `sisteransi`, `fast-wrap-ansi`, `fast-string-width`; `engines.node >= 20.12`). It has `select`, `confirm`, `text`, `password` with a masked input, `spinner`, `note`, and `log`. Every log function takes an `output` stream, so `--json` sends logs to stderr. Cancel returns a symbol checked with `isCancel`.

## Node type stripping

Node.js 24 runs `.ts` files without a flag when they use only erasable syntax. The CLI project sets `erasableSyntaxOnly` and `allowImportingTsExtensions`, and imports use `.ts`. Node types come from `@types/node` 18.19, which is installed as a dependency of another package. `import.meta.dirname` is missing from those types, so `vite.config.ts` uses `fileURLToPath(new URL(".", import.meta.url))`.
