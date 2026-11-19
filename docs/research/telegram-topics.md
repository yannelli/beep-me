# Telegram topics for Beep Me

Created: 2026-11-18. Last updated: 2026-11-18.

## Facts checked against the Bot API docs (Bot API 10.4, November 2026)

- Bot API 9.3 (2025-12-31) added `has_topics_enabled` to `User` (returned by `getMe`): "True, if the bot has forum topic mode enabled in private chats." It also allowed `message_thread_id` in private chats with topics.
- Bot API 9.4 (2026-02-09): "Allowed bots to create topics in private chats using the method createForumTopic."
- `createForumTopic` works "in a forum supergroup chat or a private chat with a user". In a supergroup the bot must be an admin with `can_manage_topics`.
- Bot API 10.4 (2026-11-09) added links to topics in private chats: `https://t.me/<bot_username>/<message_thread_id>`.
- `setWebhook` accepts `secret_token` (sent back in `X-Telegram-Bot-Api-Secret-Token`) and `allowed_updates`.

## How Beep Me uses them

1. The user pastes a bot token. Beep Me calls `getMe` and stores `has_topics_enabled` as `privateTopics`, then sets the webhook to `/hooks/telegram/<channel id>` with a per-channel secret.
2. "Open Telegram" opens `https://t.me/<bot>?start=<code>`. The `/start <code>` update links that chat as the main chat.
3. Topic threads:
   - `privateTopics` true: topics are created in the same private chat.
   - Otherwise the user can link a forum group with `https://t.me/<bot>?startgroup=<code>&admin=manage_topics`. The group must have Topics turned on.
   - Neither: low-priority messages go to the main chat with a `#topic` tag.
4. The first message for a new topic calls `createForumTopic` and stores the `message_thread_id` in `topic_threads`.
5. Each notification has a "Mute <agent> 1h" button. The webhook handles the callback for linked chats only.

## Not verified

- The @BotFather setting that turns on topic mode for private chats (the docs show the flag, not the menu path). The dashboard keys its advice on `getMe.has_topics_enabled` and offers the forum group as a fallback.
- Where a message without `message_thread_id` lands in a private chat with topics on. Beep Me sends main-chat messages without a thread id.
- No live bot was used. Linking, topic creation, and the mute button ran only against mocks.

## Sources

- https://core.telegram.org/bots/api-changelog
- https://core.telegram.org/bots/api#createforumtopic
