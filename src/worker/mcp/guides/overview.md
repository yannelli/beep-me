# Beep Me for agents

Beep Me sends your messages to the user's phone, chat apps, and email. It brings their answers back to you.

## Tools

| Tool | Use it to |
| --- | --- |
| `notify` | Send a message. Ask a question with `options` or `expect_reply`. Pick `channels`, a `topic` and its thread, and `fallbacks`. |
| `get_replies` | Read answers: text, chosen options, reactions, and files. Each answer says where it came from and which message it answers. |
| `notification_status` | See where a message went, its receipts, its answers, and its fallback steps. |
| `list_channels` | See the channels you can send to: id, name, kind, topic threads, and how the user can answer there. |
| `cancel_fallbacks` | Stop the waiting fallback steps of a message, for example when you got the answer another way. |
| `help` | Read these guides. Topics: `overview`, `notify`, `channels`, `topics`, `replies`, `waiting`, `fallbacks`, `examples`. |

## Rules

- Send one message per event: a task finished or failed, you are blocked, something is urgent, or the user asked you to report back. Skip routine progress.
- Lead the title with the outcome. Keep the message to a few sentences. Add `url` when there is a page to open.
- Beep Me applies the user's routes, quiet hours, and limits. The statuses `collapsed`, `muted`, `paused`, and `throttled` are normal. Do not retry them.
- Every answer belongs to one message id. Read `in_reply_to` before you act on an answer. When `matched_by` is `latest`, Beep Me guessed the message. Confirm before you do something you cannot undo.

## Skills

Beep Me serves three skills: `beep-me-notify` (send well), `beep-me-ask-and-wait` (ask, then wait without spending tokens), and `beep-me-fallbacks` (reach the user when they do not answer). Clients with MCP skills load them from `skill://beep-me/<name>/SKILL.md`. Other clients get the same text from the prompts with the same names, or from this `help` tool.
