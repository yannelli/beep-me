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

Beep Me lets every AI agent you run message you and read your answer. Messages go out as a text, a Telegram message, an email, a Slack or Discord post, or a phone push. Beep Me is one remote MCP (Model Context Protocol) server on Cloudflare Workers. You set it up and manage it from your phone.

- All agents use one URL. This includes Claude on the web, desktop, and mobile, Claude Code, and other MCP clients. Scripts, cron jobs, and continuous integration (CI) use a REST endpoint.
- Agents can ask you a question with choices, or ask for a written answer, and read what you sent back with the `get_replies` tool or `GET /v1/replies`. They can attach screenshots, logs, and other files, and set a sender name such as a project name.
- You sign in with Google, so there is no password to manage. The dashboard works on a phone, and you can add it to your home screen.
- You connect your own accounts and keys. Beep Me sends through Telegram, Twilio and Telnyx text messages (SMS and MMS), Resend, Gmail, SMTP, Slack, Discord, ntfy, Pushover, and webhooks. Telegram has a main chat and a thread for each topic. Each channel has a Test button.
- Priority decides where a message goes. High and urgent go out as a text message, medium goes to your Telegram chat, and low goes to the topic's thread. A new topic gets its own thread the first time an agent uses it.
- Rules route or mute messages by priority, topic, and agent. During quiet hours, Beep Me skips texts and delivers without sound. Urgent messages still break through. Each agent has a text cap and a message cap. Beep Me collapses repeated messages into one message.
- For each agent, you pick the channels it can use and the highest priority it can send. When you revoke an agent from your phone, its next call fails.
- The delivery log shows which agent sent each message, where it went, and whether it arrived. Text messages include the provider's delivery receipt. Open a message to see its answers and files.

### Where you can answer

| Where | How |
| --- | --- |
| Telegram | Tap a choice button, reply to the message, or send text, a photo, a file, or a voice note. Emoji reactions count too. |
| Text message (Telnyx, Twilio) | Text back a choice's number or text, or just write an answer. Photos come through as files. |
| Email (Resend) | Each agent sends from its own address on your domain. Reply to the email to answer. |
| ntfy | Tap a choice button, for questions with up to 3 options. |
| Dashboard | Open the message and pick a choice or write an answer. Slack, Discord, Pushover, Gmail, and SMTP messages link to it. |

### Guided setup in the dashboard

- **Telnyx:** paste an API key and Beep Me lists your numbers. The setup panel checks the messaging profile, the reply webhook, the public key, and US registration (10DLC brand and campaign, or toll-free verification). It can create a profile, send replies to Beep Me, and assign the number to one of your 10DLC campaigns.
- **Resend:** pick a domain you already have in Resend or add a new one. Beep Me shows the DNS records to add, as a zone file when Cloudflare serves the domain. It can turn on receiving and create the reply webhook.

Nothing changes in your Telnyx or Resend account until you confirm it. Beep Me shows you each change first.

## Deploy in about 3 minutes

You need [Node.js](https://nodejs.org) 24 or later, [Bun](https://bun.sh) 1.2 or later, a Cloudflare account, and a Google account.

```sh
git clone https://github.com/yannelli/beep-me.git && cd beep-me
bun install
bun run setup
```

The setup script shows each step before it changes anything. It does these steps:

1. Signs you in to Cloudflare and picks the account.
2. Creates or finds the D1 database and the KV (key-value) namespace. Saves their IDs in `.beep-me/deploy.json`, which Git ignores.
3. Asks which Google accounts can sign in.
4. Keeps the `workers.dev` address, or puts Beep Me on a hostname in one of your Cloudflare zones.
5. Builds and deploys the Worker with a new random `APP_SECRET`.
6. Shows the redirect URI for your Google OAuth client. Saves the client ID and the client secret.

Run `bun run setup --dry-run` to see the plan first. In CI or from an agent, pass the inputs as flags: `bun run setup --yes --account-id <id> --emails you@example.com`. Missing inputs exit with code 2.

Manage the deployment with `bun run cli`. With no command it opens a menu. The commands are `status`, `agents`, `channels`, `messages`, `pause`, `resume`, `emails`, `google`, `domain`, `deploy`, `logs`, `open`, `connect`, and `teardown`. `bun run cli domain` moves Beep Me to a hostname in one of your Cloudflare zones, adds alias hostnames, or goes back to `workers.dev`. Pass `--yes` to run a command without questions, or `--dry-run` to print each change first. `bun run cli <command> --help` shows the flags of one command. Each deployment documents the CLI at `/docs/reference/cli`.

Then do these steps on your phone:

1. Open the Worker URL.
2. Sign in with Google.
3. Connect a channel.
4. Press **Test**.

<details>
<summary>Manual setup</summary>

```sh
bunx wrangler d1 create beep-me                   # note the database_id
bunx wrangler kv namespace create beep-me-oauth   # note the id
mkdir -p .beep-me && cat > .beep-me/deploy.json <<'JSON'
{ "databaseId": "<database_id>", "kvNamespaceId": "<id>", "allowedEmails": "you@example.com" }
JSON
bun run deploy
openssl rand -hex 32 | bunx wrangler secret put APP_SECRET
```

Until `APP_SECRET` is set, the Worker shows a setup page. Create a Google OAuth client at https://console.cloud.google.com/auth/clients/create (type: Web application). Add the redirect URI `https://<your-worker>/auth/google/callback`. Then save the client ID and the client secret:

```sh
bunx wrangler secret put GOOGLE_CLIENT_ID
bunx wrangler secret put GOOGLE_CLIENT_SECRET
```

`allowedEmails` in `.beep-me/deploy.json` becomes `ALLOWED_EMAILS`: a comma-separated list of Google accounts. Use `*` to let any account sign up. If the list is empty, only the first account that signs in can use Beep Me.

The Worker applies the database schema on the first request. `bunx wrangler d1 migrations apply beep-me --remote` also works.
</details>

### Settings

| Name | Kind | Purpose |
| --- | --- | --- |
| `APP_SECRET` | secret | 32+ random characters. Encrypts channel keys and signs sessions. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | secret | Google sign-in, and the Gmail channel. |
| `ALLOWED_EMAILS` | var, from `allowedEmails` in `.beep-me/deploy.json` | The Google accounts that can sign in. |
| `PUBLIC_URL` | var, from `domain` in `.beep-me/deploy.json` | The custom domain. Other hosts redirect to it. `bun run cli domain` sets it. |

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

# Ask a question, then wait up to 30 seconds for the answer.
curl -X POST https://<your-worker>/v1/notify \
  -H "Authorization: Bearer $BEEPME_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Ship the redesign?","priority":"high","options":["Ship it","Wait until Monday"]}'
curl "https://<your-worker>/v1/replies?message_id=<id>&wait_seconds=30" \
  -H "Authorization: Bearer $BEEPME_TOKEN"
```

## MCP tools

| Tool | What it does |
| --- | --- |
| `notify` | Sends a message. Inputs: `message`, `title`, `priority` (`low`, `medium`, `high`, `urgent`), `topic`, `url`, `dedupe_key`, `attachments` (up to 10 files), `options` (2 to 10 choices), `expect_reply`, `sender_name`. Returns the message ID, the channels that got the message, and the routing notes. |
| `notification_status` | Shows the status of a message from this agent, with the SMS delivery receipts. |
| `get_replies` | Returns what you sent back: text replies, choices, reactions, and files. Inputs: `message_id`, `since`, `wait_seconds` (up to 50), `include_read`, `limit`. Marks the answers read. |

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

To add or change a page, read [docs/docs-site.md](docs/docs-site.md) and run `bun run check:docs`.

## Local development

```sh
cp .dev.vars.example .dev.vars   # set APP_SECRET to 32+ random characters
bun run dev                       # http://localhost:5173
```

On localhost, **Continue as developer** signs you in without Google. On localhost, Beep Me polls `getUpdates` to link Telegram, because Telegram cannot reach a local webhook.

| Command | Does |
| --- | --- |
| `bun run dev` | Runs the Worker and the dashboard with hot reload (Vite and workerd) |
| `bun run build` | Builds the Worker and the dashboard into `dist/` |
| `bun run typecheck` | Type-checks the Worker, the dashboard, and the config |
| `bun run check:docs` | Checks the docs pages: missing pages, unknown components, and broken links |
| `bun run deploy` | Builds and deploys with Wrangler |

## Project layout

```text
src/shared/     Types and schemas shared by the Worker and the dashboard
src/worker/     The Worker: MCP server, OAuth, routing, channels, JSON API
  channels/     One adapter per provider
  core/         Routing, quiet hours, delivery, replies, the notify pipeline
  hooks/        Incoming replies, choices, and delivery receipts from providers
  integrations/ Guided Telnyx and Resend setup
  auth/         Google sign-in, sessions, the OAuth approval page
src/web/        The dashboard (React 19, Tailwind CSS 4)
  docs/         The docs site at /docs: nav.ts, MDX pages in content/, components
scripts/cli/    The setup and management CLI (bun run cli)
migrations/     D1 schema
docs/           API reference and research notes (start at docs/INDEX.md)
```

## Security

- Beep Me encrypts channel keys with AES-GCM, with a key derived from `APP_SECRET`.
- Beep Me stores agent tokens as SHA-256 hashes and shows each token once.
- Beep Me uses OAuth 2.1 with PKCE, an approval page for each client, Client ID Metadata Documents, and dynamic client registration.
- Beep Me checks the agent in D1 on every call, so a revoke takes effect on the next request.
- The Telegram webhook checks a secret for each channel. SMS receipt URLs and ntfy choice buttons carry an HMAC.
- Text replies must carry a valid signature: Ed25519 with your Telnyx public key, or `X-Twilio-Signature` with your Twilio auth token. Resend replies must carry a valid Svix signature. Beep Me records email replies only from the channel's **Send to** address.
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
