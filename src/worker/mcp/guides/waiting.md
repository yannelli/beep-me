# Wait for an answer without spending tokens

Each `get_replies` call costs tokens, even when nothing arrived. Pick the cheapest way that fits the task.

| Situation | Do this |
| --- | --- |
| You have other work to do. | Keep working. Call `get_replies` with `wait_seconds: 0` between steps. |
| The answer comes in a minute or two, and you are blocked. | Call `get_replies` with `wait_seconds: 50`. Repeat 2 or 3 times at most. |
| The answer can take a long time, and you have a shell. | Run the watch loop below. It costs no tokens while it waits. |
| You have no shell (Claude on the web or phone). | Tell the user what you need and end your turn. Fallbacks reach them if they do not answer. Read the answer with `get_replies` when the user comes back. |

## The watch loop

`notify` returns `watch_url` for messages that ask something. `GET <watch_url>?wait_seconds=50` waits up to 50 seconds and returns `{"message_id":"msg_...","ready":false,"count":0,"waited_seconds":50}`. It never returns the answer text, so the URL is safe in a shell log. When `ready` is `true`, call `get_replies` once with the message id.

This loop checks for up to 90 minutes. It waits 15 seconds after a network error.

```sh
W='<watch_url>'; end=$((SECONDS+5400)); while [ $SECONDS -lt $end ]; do r=$(curl -fsS --max-time 70 "$W?wait_seconds=50") && case "$r" in *'"ready":true'*) echo "$r"; exit 0;; esac || sleep 15; done; echo "No answer after 90 minutes."; exit 2
```

Change `5400` to wait a different number of seconds. Add `sleep 60;` after `esac` to check less often.

## Background or foreground

- Background: when you can keep working. In Claude Code, run the loop with the Bash tool and `run_in_background: true`. Claude Code tells you when the command exits. Then call `get_replies`.
- Foreground: when you cannot go on without the answer. Run the loop as a normal command with a timeout longer than the wait, for example `timeout: 600000` and `end=$((SECONDS+540))`. Run it again if it exits with code 2 and you still want to wait.

Exit codes: `0` an answer is ready, `2` no answer before the end. The `notify` result text has the loop with your URL filled in.

## Combine with fallbacks

Set a `no_reply` fallback on the question, so the user hears about it again on another channel while you wait. See the `fallbacks` guide.
