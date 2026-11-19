# MCP on Cloudflare Workers (November 2026)

Created: 2026-11-18. Last updated: 2026-11-18.

What Beep Me relies on, checked against the installed packages and a local spike (`vite dev`, workerd 1.20261117).

## Packages

| Package | Version | Role in Beep Me |
| --- | --- | --- |
| `@modelcontextprotocol/server` | 2.4.0 | MCP SDK v2. `McpServer`, `createMcpHandler`, `originValidationResponse` |
| `@cloudflare/workers-oauth-provider` | 1.2.4 | OAuth 2.1 authorization server in the same Worker |
| `wrangler` | 4.164.0 | Build, types, deploy |
| `@cloudflare/vite-plugin` | 1.70.0 | Runs the Worker in workerd under `vite dev` and builds Worker plus SPA |
| `agents` | 0.33.0 | Not used. Its `createMcpHandler` wraps the SDK one and adds Origin defaults |

## MCP protocol

- SDK v2 implements MCP `2026-07-28` (stateless, a `_meta` envelope on each request) and serves 2025-era clients from the same endpoint through a stateless fallback (`legacy: "stateless"`, the default).
- `createMcpHandler(factory)` builds a fresh `McpServer` per request. `handler.fetch(request, { authInfo })` passes auth through untouched; Beep Me puts its session (user, agent, env) in `authInfo.extra`.
- The SDK handler does no Origin or Host checks. Beep Me calls `originValidationResponse()` before it.
- The `workerd` export condition selects a JSON Schema validator that does not use `new Function`. Zod input validation worked inside workerd in the spike.
- Spike results: legacy `initialize` + `tools/call` (2025-06-18), the v2 client (negotiated 2025-11-25), and a raw 2026-07-28 envelope call all returned results. A bad Origin got 403.

## OAuth provider 1.2

- One Worker can be both authorization server and resource: `new OAuthProvider({ apiRoute: "/mcp", apiHandler, defaultHandler, ... })`. `/authorize` lives in `defaultHandler` and uses `env.OAUTH_PROVIDER`.
- `resourceMetadata.resource` is required and every token is bound to it. Beep Me builds one provider per origin (`${origin}/mcp`), so workers.dev, a custom domain, and localhost all work. Set `PUBLIC_URL` to pin one origin.
- Client registration: CIMD (`clientIdMetadataDocumentEnabled: true` plus the `global_fetch_strictly_public` compatibility flag) and DCR (`clientRegistrationEndpoint`). MCP 2026-07-28 prefers CIMD and deprecates DCR for new clients.
- Consent helpers: `parseAuthRequest`, `describeConsent`, `beginConsent` (sets `X-Frame-Options: DENY` and a browser-bound cookie), `approveConsent`, `denyConsent`, `completeAuthorization`. `completeAuthorization` returns only `redirectTo`, so Beep Me stores `metadata: { agentId }` on the grant to find it again for revocation (`listUserGrants` + `revokeGrant`).
- `resolveExternalToken` accepts Beep Me's own `beep_` agent tokens on `/mcp`. It must return `audience` equal to the resource. These tokens are minted by Beep Me itself; upstream API keys are a different case that the provider docs warn about.
- KV is eventually consistent, so Beep Me re-reads the agent row in D1 on every MCP and REST call. Revoke takes effect on the next call.

## Wrangler

- `wrangler types` generates `worker-configuration.d.ts` with runtime types; `@cloudflare/workers-types` is not needed.
- Automatic resource provisioning (bindings without ids) is on by default since Wrangler 4.45 (open beta). Beep Me's `bun run setup` creates or finds the D1 database and KV namespace explicitly and writes the ids into `wrangler.jsonc`, because the Vite build copies the config into `dist/` and a write-back there would not persist.
- `wrangler deploy --secrets-file <json>` uploads secrets with the version. `wrangler secret bulk` reads JSON from stdin.
- Outbound TCP (`cloudflare:sockets`) blocks port 25. SMTP uses 465 (implicit TLS) or 587 (STARTTLS).

## Connecting clients

- Claude Code: `claude mcp add --transport http --scope user beep-me https://<host>/mcp`, then `/mcp` to sign in. Headless: add `--header "Authorization: Bearer beep_..."` (checked with `claude mcp add --help` on 2026-11-18).
- Claude (checked against the help center on 2026-11-18): Customize > Connectors > + Add > Add custom connector, then a name and the URL. The "OAuth client" choice "Use Claude's published identity (Recommended)" is the Client ID Metadata Document flow, and "Register automatically" is dynamic client registration; Beep Me supports both. "Request headers" with "No sign in" sends a fixed credential, so an `beep_` token also works there. Claude connects from Anthropic's cloud, so the server must be public on port 443 (workers.dev is). Not tested against a live deployment.
- Claude Code: `claude mcp add --transport http --scope local beep-me-check http://localhost:5173/mcp --header "Authorization: Bearer beep_..."` followed by `claude mcp list` showed "✔ Connected" against the local dev server on 2026-11-18.
- Source: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp

## Sources

- Package READMEs and docs shipped in `node_modules` (agents/docs/mcp-servers.md, workers-oauth-provider/docs/*.md).
- https://developers.cloudflare.com/changelog/2025-10-24-automatic-resource-provisioning/
- https://modelcontextprotocol.io/specification/2026-07-28

## Google sign-in and Gmail

- Sign-in uses the scopes `openid email profile`. Those scopes are exempt from the 7-day refresh token limit, and Beep Me keeps no Google token for sign-in.
- The Gmail channel asks for `https://www.googleapis.com/auth/gmail.send` with `access_type=offline`. Google's docs (checked 2026-11-18): an external app in "Testing" status "is issued a refresh token expiring in 7 days" unless it asks only for name, email, and profile. Publish the app (Google Auth Platform, Audience, Publish) to keep Gmail working past a week. The Gmail API must be on in the same project.
- Google allows 100 refresh tokens per account per client ID; a new one past that silently invalidates the oldest.
- Source: https://developers.google.com/identity/protocols/oauth2
