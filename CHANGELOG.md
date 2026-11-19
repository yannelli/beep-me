# Changelog

All notable changes to Beep Me are documented here. Versions follow [Semantic Versioning](https://semver.org/). Commits follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/); see [CONTRIBUTING.md](CONTRIBUTING.md#versions) for how they map to releases.

## [0.6.0] - 2026-11-19

### Added

- **worker:** set Telegram webhooks again once after an update ([5e5a579](https://github.com/yannelli/beep-me/commit/5e5a5791f713a4c7080588c2d280cf9327f88e9c))
- **cli:** add bun run upgrade and a bootstrap for older installs ([7665410](https://github.com/yannelli/beep-me/commit/76654101d29cc210418c3f488d3672d0a0751685))

### Fixed

- **cli:** name v0.5.1 in the upgrade.sh header ([b054bd6](https://github.com/yannelli/beep-me/commit/b054bd68c54c24455fbc768de1baed88b7500b41))

## [0.5.1] - 2026-11-19

### Fixed

- **copy:** split two-step instructions and use active voice in setup screens and the CLI ([4f5812a](https://github.com/yannelli/beep-me/commit/4f5812adf2f0ff643ed1698f3438d6f52636de51))
- **dashboard:** keep the 409 preview in API errors and drop the Resend fetch helper ([b35e1d6](https://github.com/yannelli/beep-me/commit/b35e1d67ba1eb4145e5baa4a5891b6758dc0457d))

## [0.5.0] - 2026-11-19

### Added

- **email:** link one-way email questions to the dashboard answer form ([9523ec9](https://github.com/yannelli/beep-me/commit/9523ec9f15df691cad062431f6783f144e646a27))
- **resend:** per-agent addresses, email replies, attachments, and guided domain setup ([41e3967](https://github.com/yannelli/beep-me/commit/41e396732b751d8d37a48f38cc78ac9d68a69b7d))

### Fixed

- **resend:** let a channel start without From and finish setup in the domain card ([ab28428](https://github.com/yannelli/beep-me/commit/ab28428f1b39ea9af7fd6eb8c963c28d33601eb5))

## [0.4.0] - 2026-11-19

### Added

- **telnyx:** receive replies, send MMS, and add guided setup ([c277af4](https://github.com/yannelli/beep-me/commit/c277af473b9c15fc72269d24db506bee91d6fd9f))
- **twilio:** receive text replies and send MMS ([877c522](https://github.com/yannelli/beep-me/commit/877c52236b479482c80421819f0f3a8d5a848718))

### Fixed

- **sms:** match the exact Twilio number and allow a Telnyx profile change ([0e9d823](https://github.com/yannelli/beep-me/commit/0e9d823a837a0ae4e52b22d1cd5663218a45eae0))

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
