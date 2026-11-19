# Topics and threads

Set `topic` to a short project or subject name, like the repository name or "Cat Design Project". Use the same topic for every message about that work. Beep Me creates the topic the first time you use it.

Topics do three things:

- They group messages in the Beep Me dashboard.
- They let the user mute one topic or route it with a rule.
- On Telegram (with topics on) and Discord forum channels, each topic gets its own thread.

The user's routes decide whether a priority goes to the main chat or to the topic thread. Set `topic_thread: true` to send this message into the topic thread on every channel that has threads. Channels without threads get it in the main chat.

Example:

```json
{ "title": "Logo round 2 ready", "message": "Three new logo options are in the folder.", "topic": "Cat Design Project", "topic_thread": true }
```
