# Fallbacks

A fallback step sends the same message again, to other channels, when the first send does not reach the user. The user sets steps for each priority in Beep Me. You can set steps for one message with `notify.fallbacks`. Your steps replace the user's steps for that message, and `fallbacks: []` turns them off.

Each step has:

| Field | What it does |
| --- | --- |
| `when` | `no_reply`: nobody answered, tapped a button, or reacted. `failed`: every send failed, including earlier fallback sends. `unconfirmed`: no send is confirmed. A text message counts only after its carrier delivery receipt. Other channels count when the provider accepted the message. |
| `after_minutes` | 0 to 1440, counted from the first send. Beep Me checks every minute. A `failed` step with 0 minutes runs right after the first send. |
| `channels` | 1 to 5 channel ids, names, or kinds. |
| `priority` | Optional. Send the step at this priority, for example `urgent` to break through quiet hours. Your agent's highest priority still applies. |

Each step runs at most once, and only when its condition still holds at that time. An answer on any channel, or Got it in the dashboard, stops every `no_reply` step of that message. Beep Me skips a step when Beep Me is paused or your agent is muted or revoked.

The fallback send has the same message id. Answers to it come back through `get_replies` like any other answer, and `in_reply_to.sent_to` lists it. `notification_status` shows each step with its status: `pending`, `sent`, `skipped`, or `canceled`. Call `cancel_fallbacks` when you no longer need the steps.

## Examples

Ask on Telegram, then text the user after 10 minutes with no answer:

```json
{
  "title": "Merge PR #42?",
  "message": "Tests pass. The change touches billing.",
  "options": ["Merge", "Wait"],
  "channels": ["telegram"],
  "fallbacks": [{ "when": "no_reply", "after_minutes": 10, "channels": ["twilio"] }]
}
```

Send to Slack, and use email right away when Slack fails:

```json
{ "title": "Nightly report ready", "message": "...", "channels": ["slack"], "fallbacks": [{ "when": "failed", "after_minutes": 0, "channels": ["resend"] }] }
```

Raise a waiting question to urgent after 30 minutes:

```json
{ "fallbacks": [{ "when": "no_reply", "after_minutes": 30, "channels": ["telegram", "twilio"], "priority": "urgent" }] }
```
