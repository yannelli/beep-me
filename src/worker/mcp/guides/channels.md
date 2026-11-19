# Channels

Call `list_channels` to see the channels you can send to. Each one has:

- `id` and `name`: use either in `notify.channels` or in a fallback step.
- `kind`: `telegram`, `twilio`, `telnyx`, `resend`, `gmail`, `smtp`, `slack`, `discord`, `ntfy`, `pushover`, or `webhook`. A kind in `channels` picks every channel of that kind.
- `topic_threads`: `true` when the channel can put each topic in its own thread.
- `text_message`: `true` for SMS channels. Quiet hours skip them below the user's break-through priority, and text caps apply.
- `answers`: how the user can answer there.
- `routes`: the priorities that already go to this channel.

## How the user can answer on each kind

| Kind | Answers |
| --- | --- |
| Telegram | Reply in the chat, tap an option button, react with an emoji, or send files and voice notes. |
| Twilio, Telnyx | Reply by text message. A number picks an option. |
| Resend | Reply to the email, when the channel has a reply webhook. Each agent can have its own address. |
| ntfy | Tap an option button. |
| Gmail, SMTP, Slack, Discord, Pushover, webhook | Open the message in the Beep Me dashboard and answer there. |

When you need a written answer, prefer a channel that takes replies. Telegram and text messages work best.
