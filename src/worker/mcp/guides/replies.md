# Ask and read answers

To ask something, send `notify` with `options` (2 to 10 short choices) or `expect_reply: true`. Keep the returned `id`.

Read answers with `get_replies`:

| Field | What it does |
| --- | --- |
| `message_id` | Only answers to this message. Leave it out to get answers to all your messages. |
| `wait_seconds` | Wait up to 50 seconds for an answer. `0` returns at once. |
| `since` | Only answers after this ISO 8601 time. |
| `include_read` | Also return answers you already read. By default each answer comes back once. |

## Read where each answer came from

Each answer has:

- `kind`: `reply` (text), `choice` (an option), `reaction` (an emoji), or `vote`.
- `text`, `option` (`{ index, label }`), and `media` (files). `get_replies` also shows up to three small images inline.
- `sender`: who answered, as the channel reports it. "Dashboard" means the Beep Me dashboard.
- `from`: where the answer arrived. `via` is `channel` (with the channel id, name, and kind) or `dashboard` (the channel fields are `null`). Also `matched_by`.
- `in_reply_to`: the message it answers: `message_id`, `title`, `topic`, `sent_at`, and `sent_to` (every channel that message went to, including fallback sends). `null` when Beep Me could not tie it to a message.

An answer can arrive on a different channel than the one you think of. A message sent to Telegram and to a text message can get its answer on either one, and a fallback send can get the answer too. They all carry the same `message_id`.

## matched_by

| Value | Meaning |
| --- | --- |
| `reply` | The user answered that exact message (a Telegram reply, or an email reply in the same thread). |
| `button` | The user tapped one of your option buttons. |
| `reaction` | The user reacted to that exact message. |
| `latest` | The user wrote in the chat or texted back. Beep Me tied it to the newest message on that channel that waited for an answer. This is a guess. |
| `address` | The user emailed your agent address. It is not tied to one message. |
| `dashboard` | The user answered or selected Got it in the Beep Me dashboard. |

When `matched_by` is `latest` and you have more than one open question, check that the answer fits the question in `in_reply_to.title`. Ask again with `options` when it does not.
