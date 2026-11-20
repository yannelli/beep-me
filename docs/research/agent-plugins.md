# Agent plugins and hooks: Claude Code, Codex, and pi

Created: 2026-11-19. Last updated: 2026-11-19.

Facts behind `plugins/beep-me/`. "Tested" means we ran it locally on 2026-11-19 with Claude Code 2.1.328, Codex CLI 0.170.0, and pi-rust 0.12.20. Everything else comes from the linked docs, read the same day.

## Claude Code

Sources: [hooks reference](https://code.claude.com/docs/en/hooks), [plugin manifest reference](https://code.claude.com/docs/en/plugins-reference), [marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference).

| Fact | Status |
| --- | --- |
| A `PermissionRequest` hook runs while the terminal permission dialog is on screen. Whichever answers first wins. Answering in the terminal does not kill the hook process; it keeps running until it exits or times out. | Tested |
| `AskUserQuestion` goes through `PermissionRequest`. A hook answers it with `decision.behavior: "allow"` and `updatedInput` that repeats `questions` and adds `answers` (question text to label). The terminal shows "Allowed by PermissionRequest hook". | Tested |
| `ExitPlanMode` also needs `updatedInput` with `allow`. `deny` with `message` keeps Claude in plan mode with that feedback. | Docs |
| `PermissionRequest` input has `tool_name`, `tool_input`, and `permission_suggestions`, but no `tool_use_id`. `updatedPermissions` entries take `destination: "session"` to stay in memory. | Docs |
| `asyncRewake: true` runs a command hook in the background. Exit code 2 wakes Claude at once, even when the session is idle, and shows stderr to Claude. Claude Code enforces `timeout` on these hooks. | Docs |
| `async: true` hooks do not block and have no enforced timeout. | Docs |
| Default command hook timeout: 600 seconds. `UserPromptSubmit` defaults to 30. | Docs |
| A matcher with only letters, digits, `_`, `-`, spaces, `,`, and `\|` is an exact match. Anything else is a JavaScript regex, so `notify$` matches every MCP `notify` tool. | Docs |
| Plugin MCP tools are named `mcp__plugin_<plugin>_<server>__<tool>`. | Docs |
| `userConfig` options reach hooks as `CLAUDE_PLUGIN_OPTION_<KEY>`, and `${user_config.KEY}` is substituted in MCP server `url` and `headers` and in exec-form hook `args`. Shell-form hook commands reject `${user_config.*}`. `sensitive` values go to the OS credential store. `options` on a string needs v2.1.271. | Docs |
| `version` in `plugin.json` pins installs to that version until it changes. | Docs |
| The marketplace file is `.claude-plugin/marketplace.json` at the repo root, with `name`, `owner`, and `plugins`. Relative `source` paths resolve from the repo root. | Docs |
| `Notification` with `permission_prompt` fires only after about six seconds without a keystroke, and cannot answer the prompt. | Docs |
| Hook processes get `AI_AGENT=claude-code_<version>_harness` and `CLAUDECODE=1`, which replace an inherited `AI_AGENT`. | Tested |

## Codex CLI

Sources: [hooks](https://developers.openai.com/codex/hooks), [build plugins](https://developers.openai.com/codex/plugins/build).

| Fact | Status |
| --- | --- |
| `PermissionRequest` runs before Codex shows its approval prompt. The prompt appears only after the hook returns without a decision, so a waiting hook blocks the terminal prompt. The UI shows "Running hooks" meanwhile. | Tested |
| `PermissionRequest` output: `hookSpecificOutput.decision.behavior` `allow` or `deny` with `message`. `updatedInput`, `updatedPermissions`, and `interrupt` fail closed. | Docs |
| `Stop` with `decision: "block"` and `reason` continues the session, and `reason` becomes the next prompt. `Stop` needs JSON on stdout or no output. | Docs |
| Background (`async`) hooks cannot start a turn. Their output waits for the next user turn. | Docs |
| Plugin hooks load from `hooks/hooks.json`, unless the manifest `hooks` field names other files. Hook commands get `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT`, and `CLAUDE_PLUGIN_DATA`. | Docs |
| Non-managed hooks, plugin hooks included, run only after the user trusts them in `/hooks`. A changed script needs a new review. | Docs |
| Hook input includes `turn_id` and `model`. Default timeout: 600 seconds. `commandWindows` overrides the command on Windows. | Tested |
| Codex reads marketplaces from `.agents/plugins/marketplace.json` and, for compatibility, `.claude-plugin/marketplace.json`. `codex plugin marketplace add owner/repo` adds one, and `codex plugin add <plugin>@<marketplace>` installs from it. | Docs |
| Codex plugins have no user options, so the hook scripts read `BEEPME_*` environment variables. | Docs |

## pi-rust

Sources: [pi-rust-extensions](https://github.com/yannelli/pi-rust-extensions), `extensions/hooks/README.md` and `extensions/claude-marketplace/README.md`.

| Fact | Status |
| --- | --- |
| The `claude-marketplace` extension installs Claude Code plugins: hooks go to the `hooks` extension, MCP servers to pi's MCP config, and `userConfig` values become `CLAUDE_PLUGIN_OPTION_<KEY>` and `${user_config.KEY}`. `/claude:plugin install owner/repo` adds and installs in one step. | Docs |
| pi has no permission dialog, so `PermissionRequest` hooks run on every tool call that `PreToolUse` did not decide. The Beep Me plugin skips prompts in pi for this reason. | Docs |
| `asyncRewake` is supported: exit code 2 sends stderr to the model as a follow-up message that starts a turn. | Docs |
| pi sets `PI_CODING_AGENT=true` and `AI_AGENT=pi` for its child processes. | Source (`crates/pi-coding-agent/src/main.rs`) |

## End-to-end runs on 2026-11-19

Against a local `bun run dev` with a webhook channel. Answers came from the dashboard answer API.

- Claude Code, plugin installed from this repo's marketplace and configured with `claude plugin configure --values-stdin`: an `AskUserQuestion` answer, a Bash allow and deny, a plan sent back with feedback and then approved, **Allow for this session** on a `Write` (it switched the session to accept edits), and a `notify` question whose answer woke the idle session through `asyncRewake`.
- Claude Code: answering **Yes** or **No** in the terminal before `ask_after` sent nothing to the phone. After **No**, a `PostToolUse` or `PostToolUseFailure` hook marked the prompt answered.
- Codex, plugin installed from `.agents/plugins/marketplace.json` with `--dangerously-bypass-hook-trust`: the `Stop` hook waited ("Waiting for your Beep Me answer") and continued the session with the answer. With `BEEPME_PROMPTS=on`, an escalated command waited for a phone answer and ran after "ok". Codex names MCP tools so that `notify$` matches.

## Still unverified

- pi with the plugin installed through `/claude:plugin`, including the MCP tool names it reports to hooks.
- Codex and Claude Code on Windows. The Codex hooks file has `commandWindows`; Claude Code runs exec-form `node` there.
