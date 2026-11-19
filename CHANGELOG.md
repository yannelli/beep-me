# Changelog

All notable changes to Beep Me are documented here. Versions follow [Semantic Versioning](https://semver.org/). Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/); see [CONTRIBUTING.md](CONTRIBUTING.md#versions) for how they map to releases.

## [0.3.0] - 2026-11-19

### Added

- **telegram:** answer agents with buttons, replies, files, and reactions ([8bc9215](https://github.com/yannelli/beep-me/commit/8bc9215ee08f5674390b8007ba12b93a2b6be6bf))

## [0.2.0] - 2026-11-19

### Added

- **dashboard:** answer questions from the message sheet ([7a96047](https://github.com/yannelli/beep-me/commit/7a96047f648e689704c7492f6601cbd3ea3af718))
- **cli:** guided setup, headless flags, management commands, and custom domains ([98b43e8](https://github.com/yannelli/beep-me/commit/98b43e8152c56bc763345ff81df88b0c91ec5075))
- **channels:** send files and choices on Discord, Slack, ntfy, Pushover, and webhooks ([3c769ab](https://github.com/yannelli/beep-me/commit/3c769abe5b8c484436e54acad3d3f3b0288e440e))
- **core:** let channels set the agent of an inbound reply ([a8547f8](https://github.com/yannelli/beep-me/commit/a8547f8e88133a1d4d8dca73713de74f65c20200))
- **core:** let agents ask questions, send files, and read replies ([e4382c2](https://github.com/yannelli/beep-me/commit/e4382c2a16ca83b2c35921a10323b032221cb87d))

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
