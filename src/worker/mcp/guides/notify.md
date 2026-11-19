# Send a message with notify

| Field | What it does |
| --- | --- |
| `message` | Required. The body, a few sentences at most. |
| `title` | A short headline that leads with the outcome, like "Deploy finished". |
| `priority` | `urgent`: act now, can break through quiet hours. `high`: important and time sensitive, often a text message. `medium` (default): worth seeing today. `low`: background information. |
| `topic` | A project or subject name, like the repository name. Each topic gets its own thread on channels that have threads. |
| `topic_thread` | `true` sends into the topic's thread on every channel that has one, and to the main chat elsewhere. |
| `channels` | Up to 5 channel ids, names, or kinds (like `telegram`). They replace the user's route for this message. `list_channels` shows them. |
| `fallbacks` | Steps that send the message again when nobody answers or a send fails. See the `fallbacks` guide. |
| `options` | 2 to 10 short choices. The user taps a button or answers with the number. |
| `expect_reply` | `true` when you want a written answer. |
| `attachments` | Up to 10 files: `{ "url": "https://..." }` or `{ "data": "<base64>", "filename": "log.txt" }`, up to 20 MB each. |
| `sender_name` | A display name next to your agent name, like "Cat Design Project". |
| `url` | A link to open, like a pull request. |
| `dedupe_key` | Messages with the same key inside the user's collapse window merge into one. |

## What comes back

- `id`: keep it. You need it for `get_replies`, `notification_status`, and `cancel_fallbacks`.
- `status`: `delivered`, `partial`, `failed`, or a hold such as `muted`.
- `deliveries`: each channel with its id, kind, target (`main` or `topic`), and result.
- `fallbacks`: the steps that wait for their time, with `due_at`.
- `watch_url`: only for messages that ask something. See the `waiting` guide.
- `notes`: plain sentences about each routing choice. Read them when a result surprises you.

## Choosing channels

Leave `channels` out in most cases. The user set routes for each priority. Pick channels when the user asked for one ("text me when it is done") or when the content fits one channel (a long report goes to email).

Your choice still goes through pause, mutes, mute rules, your channel access, quiet hours, and text caps. When none of your channels can take the message, Beep Me uses the user's route and says so in `notes`.
