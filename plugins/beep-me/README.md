# Beep Me plugin

Hooks for Claude Code, Codex, and pi that connect them to [Beep Me](https://github.com/yannelli/beep-me), a self-hosted server that messages you by SMS, Telegram, email, Slack, Discord, or phone push.

- **Prompts on your phone (Claude Code):** permission prompts, `AskUserQuestion` questions, and plans go to your phone when nobody answers in the terminal within 15 seconds. The first answer wins.
- **Answers back to the agent:** when an agent asks something with the Beep Me `notify` tool, the plugin waits for the answer at no token cost. Claude Code and pi wake up with the answer. Codex continues the session with it when the turn ends.
- **Approvals on your phone (Codex, opt in):** set `BEEPME_PROMPTS=on`.

Full guide: `/docs/agents/plugin` on your Beep Me deployment, or [plugin.mdx](../../src/web/docs/content/agents/plugin.mdx) in this repository. You need Node.js 20 or later and a Beep Me agent token from **Agents > Connect > Plugin**.

## Install

| Client | Commands |
| --- | --- |
| Claude Code | `claude plugin marketplace add yannelli/beep-me`, then `claude plugin install beep-me@beep-me`. Set `url` and `token` in `/plugin`, or pipe them as JSON to `claude plugin configure beep-me@beep-me --values-stdin`. |
| Codex | Export `BEEPME_URL` and `BEEPME_TOKEN`. Run `codex plugin marketplace add yannelli/beep-me` and `codex plugin add beep-me@beep-me`. Add the MCP server with `codex mcp add beep-me --url <url>/mcp --bearer-token-env-var BEEPME_TOKEN`. Trust the hooks in `/hooks`. |
| pi | `/claude:plugin install yannelli/beep-me`, enter the URL and the token, then `/reload`. |

## Layout

| Path | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | Claude Code and pi manifest: user options and the Beep Me MCP server. |
| `.codex-plugin/plugin.json` | Codex manifest. It points Codex at `hooks/codex.json`. |
| `hooks/hooks.json` | Claude Code and pi hooks. |
| `hooks/codex.json` | Codex hooks. |
| `scripts/beep-me.mjs` | The entry point every hook runs: `beep-me.mjs <event> [codex] [--wait=<seconds>]`. |
| `scripts/events/` | One file per job: prompts (`PermissionRequest`), replies (`notify` answers and the Codex `Stop` wait), and session bookkeeping. |
| `scripts/lib/` | Settings, the REST client, state files, message text, and answer parsing. |

The scripts use only Node.js built-ins. `bun run typecheck` checks them through `tsconfig.plugin.json`. Platform facts and test notes are in [docs/research/agent-plugins.md](../../docs/research/agent-plugins.md).
