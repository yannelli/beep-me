# Changelog

All notable changes to Beep Me are documented here. Versions follow [Semantic Versioning](https://semver.org/). Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/); see [CONTRIBUTING.md](CONTRIBUTING.md#versions) for how they map to releases.

## [0.1.0] - 2026-11-18

### Added

- **mcp:** remote MCP server on Cloudflare Workers with the `notify` and `notification_status` tools, the `notify-when-done` prompt, and server instructions. Serves MCP 2026-07-28 and 2025-era clients.
- **auth:** Google sign-in, OAuth 2.1 for MCP clients (Client ID Metadata Documents and dynamic client registration), an approval page that sets each agent's name, highest priority, and channels, and `beep_` agent tokens for scripts and CI.
- **api:** `POST /v1/notify` for curl, cron, and CI, with JSON or plain-text bodies.
- **channels:** Telegram (main chat plus a thread per topic), Twilio and Telnyx SMS with delivery receipts, Resend, Gmail, SMTP, Slack, Discord (forum post per topic), ntfy, Pushover, and signed webhooks. Each channel has a Test button.
- **routing:** priority routes that follow your channels, rules by priority, topic, and agent, quiet hours with break-through, a text cap and a message cap per agent, collapsed repeats, and pause.
- **dashboard:** phone-first web app to manage channels, agents, routing, and the delivery log. Installs to the home screen.
- **docs:** docs site at `/docs` on every deployment, with search and copy-ready commands for that deployment.
- **deploy:** `npm run setup` creates the D1 database and KV namespace, sets secrets, and deploys.
