<p align="center">
  <img alt="Beep Me logo" src="public/icon.svg" width="96">
</p>

<h1 align="center">Beep Me</h1>

<p align="center">
  <a href="https://github.com/yannelli/beep-me/releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/yannelli/beep-me?sort=semver"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/yannelli/beep-me"></a>
  <a href="https://modelcontextprotocol.io/specification/2026-07-28"><img alt="MCP 2026-07-28" src="https://img.shields.io/badge/MCP-2026--07--28-8b5cf6"></a>
  <a href="https://workers.cloudflare.com/"><img alt="Runs on Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white"></a>
</p>

Beep Me lets every AI agent you run send you a message: a text, a Telegram message, an email, a Slack or Discord post, or a phone push. It is one remote MCP (Model Context Protocol) server on Cloudflare Workers. You set it up and manage it from your phone.

- All agents use one URL. This includes Claude on the web, desktop, and mobile, Claude Code, and other MCP clients. Scripts, cron jobs, and continuous integration (CI) use a REST endpoint.
- You sign in with Google, so there is no password to manage. The dashboard works on a phone, and you can add it to your home screen.
- You connect your own accounts and keys. Beep Me sends through Telegram, Twilio SMS, Telnyx SMS, Resend, Gmail, SMTP, Slack, Discord, ntfy, Pushover, and webhooks. Telegram has a main chat and a thread for each topic. Each channel has a Test button.
- Priority decides where a message goes. High and urgent go out as a text message (SMS), medium goes to your Telegram chat, and low goes to the topic's thread. A new topic gets its own thread the first time an agent uses it.
- Rules route or mute messages by priority, topic, and agent. During quiet hours, Beep Me skips texts and delivers without sound. Urgent messages still break through. Each agent has a text cap and a message cap. Beep Me collapses repeated messages into one message.
- For each agent, you pick the channels it can use and the highest priority it can send. When you revoke an agent from your phone, its next call fails.
- The delivery log shows which agent sent each message, where it went, and whether it arrived. Text messages include the provider's delivery receipt.

## Deploy in about 3 minutes

You need Node 22 or later, a Cloudflare account, and a Google account.

```sh
git clone https://github.com/yannelli/beep-me.git && cd beep-me
npm install
npm run setup
```

The setup script does these steps:

1. Signs you in to Cloudflare.
2. Creates or finds the D1 database and the KV (key-value) namespace. Writes their IDs to `wrangler.jsonc`.
3. Asks which Google accounts can sign in.
4. Builds and deploys the Worker with a new random `APP_SECRET`.
5. Shows the redirect URI for your Google OAuth client. Saves the client ID and the client secret.

Then do these steps on your phone:

1. Open the Worker URL.
2. Sign in with Google.
3. Connect a channel.
4. Press **Test**.

<details>
<summary>Manual setup</summary>

```sh
npx wrangler d1 create beep-me            # copy database_id into wrangler.jsonc
npx wrangler kv namespace create beep-me-oauth   # copy id into the OAUTH_KV binding
npm run deploy
openssl rand -hex 32 | npx wrangler secret put APP_SECRET
```

Until `APP_SECRET` is set, the Worker shows a setup page. Create a Google OAuth client at https://console.cloud.google.com/auth/clients/create (type: Web application). Add the redirect URI `https://<your-worker>/auth/google/callback`. Then save the client ID and the client secret:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

Set `ALLOWED_EMAILS` in `wrangler.jsonc` to a comma-separated list of Google accounts. Use `*` to let any account sign up. If the list is empty, only the first account that signs in can use Beep Me.

The Worker applies the database schema on the first request. `npx wrangler d1 migrations apply beep-me --remote` also works.
</details>

### Settings

| Name | Kind | Purpose |
| --- | --- | --- |
| `APP_SECRET` | secret | 32+ random characters. Encrypts channel keys and signs sessions. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | Google sign-in, and the Gmail channel. |
| `ALLOWED_EMAILS` | var | The Google accounts that can sign in. |
| `PUBLIC_URL` | var, optional | Set it when you serve Beep Me on a custom domain. |

## Connect your agents

| Client | How |
| --- | --- |
| Claude (web, desktop, mobile) | Open Customize > Connectors. Select + Add, then Add custom connector. Paste `https://<your-worker>/mcp`. Keep the recommended sign-in options. Sign in. Choose the agent's limits. |
| Claude Code | Run `claude mcp add --transport http --scope user beep-me https://<your-worker>/mcp`. Then run `/mcp` in Claude Code to sign in. |
| Other MCP clients | Use the same URL. The client signs in with OAuth at the first connection. |
| Scripts, cron, CI, headless agents | Create a token under **Agents**. Use it as a Bearer token on `/mcp` or `/v1/notify`. |

Each OAuth connection shows an approval page. On this page, you set the agent name, its highest priority, and its channels.

### REST

```sh
curl -X POST https://<your-worker>/v1/notify \
  -H "Authorization: Bearer $BEEPME_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Nightly backup finished","priority":"low","topic":"backups"}'

# Plain text works too. Put the options in headers.
curl -d "Deploy finished" -H "Authorization: Bearer $BEEPME_TOKEN" \
  -H "X-Priority: medium" -H "X-Topic: api" https://<your-worker>/v1/notify
```

## MCP tools

| Tool | What it does |
| --- | --- |
| `notify` | Sends a message. Inputs: `message`, `title`, `priority` (`low`, `medium`, `high`, `urgent`), `topic`, `url`, `dedupe_key`. Returns the channels that got the message, and the routing notes. |
| `notification_status` | Shows the status of a message from this agent, with the SMS delivery receipts. |

The prompt `notify-when-done` tells the agent to send a message when the current task finishes or gets stuck. The server instructions tell agents when to notify and how to pick a priority.

## How Beep Me routes a message

1. The agent's priority cap lowers the priority if necessary.
2. Beep Me holds the message if you paused all messages, muted the agent, or muted the topic. A muted topic holds only low and medium messages.
3. Beep Me merges an identical message from the same agent into the first one if it arrives inside the collapse window (default: 10 minutes). Beep Me edits the first Telegram message to show the count.
4. If an agent goes over its hourly message cap, Beep Me holds its messages. You get one alert.
5. The first rule that matches picks the destinations. If no rule matches, the priority route picks them.
6. During quiet hours, messages below the break-through level skip the text and arrive without sound.
7. A text over the agent's hourly text cap goes to the next route down.
8. When no destination is usable, the message goes to the next route down. Beep Me writes every decision to the log.

Until you edit routes, they follow your channels: texts for urgent and high, the Telegram main chat for medium, and topic threads for low.

## Docs

Every deployment serves its own docs at `/docs`, for example `https://beep-me.<you>.workers.dev/docs`. Readers do not need to sign in. The docs cover setup, each agent client, each channel, routing, and the MCP and REST reference. Code examples show the address of the deployment you read them on.

To add or change a page, read [docs/docs-site.md](docs/docs-site.md) and run `npm run check:docs`.

## Local development

```sh
cp .dev.vars.example .dev.vars   # set APP_SECRET to 32+ random characters
npm run dev                       # http://localhost:5173
```

On localhost, **Continue as developer** signs you in without Google. On localhost, Beep Me polls `getUpdates` to link Telegram, because Telegram cannot reach a local webhook.

| Command | Does |
| --- | --- |
| `npm run dev` | Runs the Worker and the dashboard with hot reload (Vite and workerd) |
| `npm run build` | Builds the Worker and the dashboard into `dist/` |
| `npm run typecheck` | Type-checks the Worker, the dashboard, and the config |
| `npm run check:docs` | Checks the docs pages: missing pages, unknown components, and broken links |
| `npm run deploy` | Builds and deploys with Wrangler |

## Project layout

```text
src/shared/     Types and schemas shared by the Worker and the dashboard
src/worker/     The Worker: MCP server, OAuth, routing, channels, JSON API
  channels/     One adapter per provider
  core/         Routing, quiet hours, delivery, the notify pipeline
  auth/         Google sign-in, sessions, the OAuth approval page
src/web/        The dashboard (React 19, Tailwind CSS 4)
  docs/         The docs site at /docs: nav.ts, MDX pages in content/, components
migrations/     D1 schema
docs/           API reference and research notes (start at docs/INDEX.md)
```

## Security

- Beep Me encrypts channel keys with AES-GCM, with a key derived from `APP_SECRET`.
- Beep Me stores agent tokens as SHA-256 hashes and shows each token once.
- Beep Me uses OAuth 2.1 with PKCE, an approval page for each client, Client ID Metadata Documents, and dynamic client registration.
- Beep Me checks the agent in D1 on every call, so a revoke takes effect on the next request.
- The Telegram webhook checks a secret for each channel. SMS receipt URLs carry an HMAC.
- If an SMTP server does not offer STARTTLS, Beep Me does not send your password to it.

## Status

These items passed local checks:

- The full OAuth flow, and MCP on the 2025 and 2026-07-28 protocol versions.
- Token agents, REST, collapse, the rate cap, and revoke.
- Webhook delivery and the SMTP STARTTLS guard.

These items have no check yet: a real deploy, and live sends through each provider. See [docs/INDEX.md](docs/INDEX.md) for verified provider facts and open items.

For Gmail with Google sign-in, turn on the Gmail API in your Google Cloud project. If your Google app is in Testing status, Google stops the refresh token after 7 days. Publish the app to prevent this.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the commit format, and how releases work. Releases follow [Semantic Versioning](https://semver.org/); see [CHANGELOG.md](CHANGELOG.md). Report security problems privately as described in [SECURITY.md](SECURITY.md). This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Maintainer

Built by [Ryan Yannelli](https://ryanyannelli.com) ([@yannelli](https://github.com/yannelli) on GitHub).

## License

[MIT](LICENSE)
