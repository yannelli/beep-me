# Telegram topics for Beep Me

Created: 2026-11-18. Last updated: 2026-11-19.

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

## Answers, files, and reactions (Bot API 10.4, checked 2026-11-19)

- `callback_data` is 1 to 64 bytes. Beep Me sends `ans:<message id>:<index>` (about 27 bytes).
- Bot API 10.3 added `force_reply` to `InlineKeyboardMarkup`: the reply field opens and the buttons stay. "The value of the field can't be changed when the inline keyboard is edited." `ForceReply` (with `input_field_placeholder`, 1 to 64 characters) is the markup when there are no buttons.
- Captions hold 0 to 1024 characters after entity parsing. Text messages hold 4096.
- `sendMediaGroup` takes 2 to 10 items and no `reply_markup`. "Documents and audio files can be only grouped in an album with messages of the same type." There is no voice type in `InputMedia`.
- Upload limits: 10 MB for photos, 50 MB for other files. By URL: 5 MB photos, 20 MB other, and `sendDocument` by URL works only for PDF and ZIP. Beep Me always uploads with `load()`.
- `getFile` downloads up to 20 MB. The file URL `https://api.telegram.org/file/bot<token>/<file_path>` is valid for at least 1 hour and holds the token.
- `message_reaction` arrives only when listed in `allowed_updates`, and not for reactions set by bots. The docs say "The bot must be an administrator in the chat".
- `setMessageReaction`: bots set at most 1 reaction, from the `ReactionTypeEmoji` list. 👀 is on it.
- Link previews stay off: Telegram's servers fetch the link to build a preview, and agents send private links.
- Polls are not used. Buttons carry the same single choice, keep the message format, and let Beep Me edit the message to show the answer.

## Not verified

- The @BotFather setting that turns on topic mode for private chats (the docs show the flag, not the menu path). The dashboard keys its advice on `getMe.has_topics_enabled` and offers the forum group as a fallback.
- Where a message without `message_thread_id` lands in a private chat with topics on. Beep Me sends main-chat messages without a thread id.
- No live bot was used. Linking, topic creation, the mute button, answers, files, and reactions ran only against mocks.
- Whether `message_reaction` arrives in a private chat, where the bot cannot be an admin.
- How Telegram clients show `force_reply` on an inline keyboard (Bot API 10.3).

## Sources

- https://core.telegram.org/bots/api-changelog
- https://core.telegram.org/bots/api#createforumtopic
