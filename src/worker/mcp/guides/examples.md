# Examples

A task finished:

```json
{ "title": "Deploy finished", "message": "v2.3.0 is live. 0 errors in the first 5 minutes.", "topic": "web-app", "url": "https://github.com/acme/web-app/releases/tag/v2.3.0" }
```

A task failed and needs the user soon:

```json
{ "title": "Migration failed on step 3", "message": "The users table has 12 rows with a null email. I stopped before any change.", "priority": "high", "topic": "web-app" }
```

Ask a question with buttons, then wait in the background (Claude Code):

1. `notify` with `{ "title": "Which logo?", "message": "Options are in the folder.", "options": ["A", "B", "C"], "topic": "Cat Design Project", "sender_name": "Cat Design Project" }`.
2. Run the watch loop from the `notify` result with Bash and `run_in_background: true`. Keep working.
3. When the command exits with code 0, call `get_replies` with `{ "message_id": "<id>" }`.
4. Read `option.label`, `from`, and `in_reply_to.title`, then act.

Ask for a written answer and wait in the foreground for a short time:

1. `notify` with `{ "title": "Need the staging password", "message": "Paste it here or in 1Password.", "expect_reply": true, "priority": "high" }`.
2. `get_replies` with `{ "message_id": "<id>", "wait_seconds": 50 }`, 2 or 3 times.
3. No answer yet: say what you wait for and end your turn.

Send a screenshot to one channel:

```json
{ "title": "New dashboard layout", "message": "Screenshot attached.", "channels": ["telegram"], "attachments": [{ "data": "<base64 png>", "filename": "dashboard.png" }] }
```

Check where a message went and what is still waiting: `notification_status` with `{ "id": "<id>" }`.

Stop the reminders after you got the answer in the terminal: `cancel_fallbacks` with `{ "message_id": "<id>" }`.
