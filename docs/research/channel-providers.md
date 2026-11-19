# Channel provider facts

Created: 2026-11-18. Last updated: 2026-11-19.

What the adapters in `src/worker/channels/` rely on, checked against each provider's official docs on 2026-11-18. Shared HTTP rules for all adapters: 10 s timeout, one retry on 429 or 5xx (waits for Retry-After, at most 3 s), no retry after a timeout or network error.

## Telegram Bot API

- Source: https://core.telegram.org/bots/api (local copy of Bot API 10.4, dated 2026-11-09).
- Endpoint: `POST https://api.telegram.org/bot<token>/<method>` with a JSON body. The token is in the URL, so the URL is a secret.
- Errors: `{ ok: false, error_code, description, parameters?: { retry_after, migrate_to_chat_id } }`. The docs say `error_code` can change, so the adapter shows `description`.
- Limits: message text 1-4096 characters after entity parsing; `callback_data` 1-64 bytes; topic name 1-128 characters.
- `createForumTopic` works in a forum supergroup (bot is admin with `can_manage_topics`) and in a private chat with a user. `getMe` returns `has_topics_enabled` when forum topic mode is on in private chats.
- `setWebhook`: `secret_token` is 1-256 characters of `A-Za-z0-9_-`; Telegram sends it in `X-Telegram-Bot-Api-Secret-Token`. Webhook ports: 443, 80, 88, 8443. `getUpdates` stops working while a webhook is set.
- `editMessageText` replaces the whole text. The adapter re-renders the message and sends the inline keyboard again.

## Twilio Programmable Messaging

- Source: https://www.twilio.com/docs/messaging/api/message-resource, https://www.twilio.com/docs/usage/twilios-response, https://www.twilio.com/docs/iam/api/account
- Endpoint: `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`, form encoded: `To`, `Body`, `From` or `MessagingServiceSid`, `StatusCallback`.
- Auth: HTTP Basic `AccountSid:AuthToken`. Twilio recommends API key SID and secret for production.
- Response: `sid` (SM... for SMS). Errors: `{ code?, message, more_info?, status }`.
- Limit: `Body` up to 1,600 characters. Beep Me sends at most two segments (see `src/worker/channels/sms.ts`).
- Verify: `GET /2010-04-01/Accounts/{AccountSid}.json` returns `friendly_name` and `status`.
- SMS text (`sms.ts`, used by Twilio and Telnyx) starts with `Beep Me: <agent> (<Priority>, #topic)`. Beep Me converts smart quotes, dashes, "·", "×", and emoji to GSM-7 characters. A GSM-7 text is cut at 306 characters (two 153-character segments). A text with other characters, for example CJK, uses UCS-2 and is cut at 134 characters (two 67-character segments). The link is kept when it fits.

- Outbound MMS: `MediaUrl` repeats, up to 10 per message. JPEG, PNG, and GIF up to 5 MB are resized; other accepted types up to 500 KB; the 5 MB cap covers body and media. MMS reaches the US, Canada, and Australia; to other countries Twilio returns 400 unless MMS Converter is on. Twilio sends GET and HEAD to read `Content-Type`. Sources: https://www.twilio.com/docs/messaging/api/message-resource, https://www.twilio.com/docs/messaging/guides/accepted-mime-types, https://help.twilio.com/articles/360032795214
- Beep Me sends JPEG, PNG, and GIF only (images first, 10 files, 5 MB), to `+1` and `+61`. Files with no known size count as 0, so a 4xx on a send with media is retried once with every file as a link.
- Incoming webhook: form encoded `MessageSid`, `SmsSid`, `AccountSid`, `MessagingServiceSid`, `From`, `To`, `Body`, `NumMedia`, `MediaUrl{N}`, `MediaContentType{N}` (N from 0), `OptOutType` (`START`, `STOP`, `HELP`, only with Advanced Opt-Out). Source: https://www.twilio.com/docs/messaging/guides/webhook-request
- Signature: `X-Twilio-Signature` = Base64 HMAC-SHA1 (key: Auth Token) of the full URL (scheme, port, query) followed by each POST parameter name and value, sorted by name, no delimiters. Source: https://www.twilio.com/docs/usage/security
- Inbound media URL: `https://api.twilio.com/2010-04-01/Accounts/AC…/Messages/MM…/Media/ME…`. HTTP Basic auth is enforced on new accounts since 2023-06-08; the fetch redirects to a `mms.twiliocdn.com` URL valid for 4 hours. Beep Me sends Basic auth to the Twilio host only and follows the redirect without it. Sources: https://www.twilio.com/docs/messaging/api/media-resource, https://www.twilio.com/en-us/changelog/upcoming-security-changes-enforcing-http-authentication-for-media
- Inbound URL: `GET /IncomingPhoneNumbers.json?PhoneNumber=` then `POST /IncomingPhoneNumbers/{PN…}.json` with `SmsUrl`, `SmsMethod=POST`. `SmsApplicationSid` overrides `SmsUrl`. In a Messaging Service, the service `inbound_request_url` wins unless `use_inbound_webhook_on_number=true`. Sources: https://www.twilio.com/docs/phone-numbers/api/incomingphonenumber-resource, https://www.twilio.com/docs/messaging/api/service-resource
- Keywords: opt-out `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `REVOKE`, `OPTOUT`, `QUIT` (single word, still forwarded); opt-in `START`, `YES`, `UNSTOP` (forwarded); help `HELP`, `INFO` (forwarded only with Advanced Opt-Out). Beep Me records `YES` as a reply. Source: https://help.twilio.com/articles/223134027
- No-reply response: empty `<Response></Response>` with `text/xml`. Source: https://www.twilio.com/docs/usage/webhooks/messaging-webhooks

## Telnyx Messaging

- Source: https://developers.telnyx.com/api-reference/messages/send-a-message, https://developers.telnyx.com/api-reference/messaging-profiles/list-messaging-profiles
- Endpoint: `POST https://api.telnyx.com/v2/messages`, `Authorization: Bearer <key>`, JSON `{ from, to, text, messaging_profile_id?, webhook_url? }`.
- Response: `data.id` (UUID). Errors: `{ errors: [{ code (string), title, detail?, source?, meta? }] }`.
- `messaging_profile_id` is required for number pool or alphanumeric senders.
- Verify: `GET /v2/messaging_profiles?page[size]=1`. `GET /v2/balance` also works but returns 403 (code 10010) for keys without billing access.
- Facts below come from the Telnyx OpenAPI spec (https://raw.githubusercontent.com/team-telnyx/openapi/master/openapi/spec3.json, server `https://api.telnyx.com/v2`) and the guides named per line, read 2026-11-18.
- Outbound MMS: `media_urls` (up to 10, error 42204), optional `subject`. MMS reaches US and Canada long code, toll-free, and short code. Types: JPEG, PNG, GIF, BMP, TIFF, WebP, MP4, 3GP, MOV, MP3, WAV, AMR, OGG, PDF, vCard, iCal. Source: https://developers.telnyx.com/docs/messaging/messages/mms-transcoding
- Inbound `message.received`: `data.payload` has `id`, `direction`, `type` (`SMS`/`MMS`), `text` (null for media only), `from.phone_number`, `to[].phone_number`, `media[]` (`url`, `content_type`, `size`, `sha256`), `autoresponse_type` on keyword messages. Source: https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks
- Signature: `telnyx-signature-ed25519` (Base64) over `<telnyx-timestamp>|<raw body>`; the public key is a Base64 raw 32-byte Ed25519 key from Keys & Credentials > Public Key in the portal. Reject timestamps older than 5 minutes. No API returns the public key, so the user pastes it.
- Inbound media URLs need `Authorization: Bearer <API key>` and expire after 30 days. Source: https://developers.telnyx.com/docs/messaging/messages/receive-message
- Keywords: opt-out `STOP`, `STOPALL`, `STOP ALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`; opt-in `START`, `UNSTOP`. They still arrive as `message.received`. Source: https://developers.telnyx.com/docs/messaging/messages/advanced-opt-in-out
- Numbers: `GET /phone_numbers/messaging` (`page[size]` up to 250, `filter[phone_number]`) returns `id`, `phone_number`, `messaging_profile_id`, `type` (`long-code`, `toll-free`, `short-code`, and forms without dashes). Assign: `PATCH /phone_numbers/{id}/messaging` with `messaging_profile_id`; `{id}` is the number id from that list.
- Profiles: `GET /messaging_profiles` (`page[size]` up to 250); `POST /messaging_profiles` requires `name` and `whitelisted_destinations` (ISO codes or `["*"]`); `PATCH /messaging_profiles/{id}` takes `webhook_url` and `webhook_api_version` (`"1"`, `"2"`, `"2010-04-01"`).
- 10DLC under `/v2/10dlc`: `GET /phone_number_campaigns/{phoneNumber}` (`campaignId`, `brandId`, `assignmentStatus`: `ASSIGNED`, `PENDING_ASSIGNMENT`, `FAILED_ASSIGNMENT`, `PENDING_UNASSIGNMENT`, `FAILED_UNASSIGNMENT`, `failureReasons`); `POST /phone_number_campaigns` `{ phoneNumber, campaignId }`; `GET /brand` and `GET /campaign?brandId=` (required) return `{ records, page, totalRecords }`; `GET /brand/{id}` returns the brand without a `data` wrapper (`displayName`, `companyName`, `status`, `identityStatus`); `GET /campaign/{id}` returns `usecase`, `description`, `campaignStatus`.
- Toll-free: `GET /messaging_tollfree/verification/requests?phone_number=&page=&page_size=` (page and page_size required) returns `{ records, total_records }` with `verificationStatus` (`Verified`, `Rejected`, `Waiting For Vendor`, `Waiting For Customer`, `Waiting For Telnyx`, `In Progress`) and `reason`.

## Resend

- Source: https://resend.com/docs/api-reference/emails/send-email, https://resend.com/docs/api-reference/introduction, https://resend.com/docs/api-reference/rate-limit, https://resend.com/docs/api-reference/errors
- Endpoint: `POST https://api.resend.com/emails`, `Authorization: Bearer re_...`, JSON `{ from, to, subject, html, text }`. Response `{ id }`.
- Every request needs a `User-Agent` header or Resend returns 403. The adapter sends `BeepMe/0.1`.
- `Idempotency-Key`: 1-256 characters, kept 24 hours. Same key with a different body returns 409 `invalid_idempotent_request`.
- Rate limit: 10 requests per second per team, 429 `rate_limit_exceeded` with `retry-after`. Daily and monthly quota errors are also 429.
- Sending-only keys get 401 `restricted_api_key` on read endpoints, so there is no verify call.

## Gmail (OAuth and app password)

- Source: https://developers.google.com/identity/protocols/oauth2/web-server, https://developers.google.com/identity/protocols/oauth2, https://developers.google.com/workspace/gmail/api/guides/sending, https://developers.google.com/workspace/gmail/api/guides/handle-errors, https://support.google.com/accounts/answer/185833, https://knowledge.workspace.google.com/admin/sync/transition-from-less-secure-apps-to-oauth
- Token refresh: `POST https://oauth2.googleapis.com/token`, form `grant_type=refresh_token, client_id, client_secret, refresh_token`. Response `{ access_token, expires_in }`. A revoked or expired refresh token returns HTTP 400 `{ error: "invalid_grant" }`.
- Refresh tokens stop working when the OAuth app is in Testing status (7 days), after 6 months unused, after a password change (Gmail scopes), or past 100 tokens per client ID.
- Send: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, JSON `{ raw }`, base64url of an RFC 2822 message. Scope: `gmail.send` (or compose, modify, full mail).
- Errors: `{ error: { code, message, errors: [{ domain, reason, message }] } }`.
- The adapter stores `accessTokenExpiresAt` in epoch milliseconds and refreshes 60 s before expiry, or once after a 401.
- App password mode: `smtp.gmail.com:465` implicit TLS. Needs 2-Step Verification. Not offered for work or school accounts, Advanced Protection, or security-key-only 2SV. Google turned off plain-password SMTP on 2025-03-14; app passwords still work. Limit: 2,000 messages per day.

## SMTP (worker-mailer 1.3.1 over cloudflare:sockets)

- Source: `node_modules/worker-mailer/README.md` and `dist/index.mjs`, https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- `security: "tls"` maps to `{ secure: true, startTls: false }` (socket `secureTransport: "on"`, port 465). `"starttls"` maps to `{ secure: false, startTls: true }` (port 587).
- worker-mailer authenticates only with methods listed in `authType`; the default is none. The adapter passes `["plain", "login", "cram-md5"]`.
- In STARTTLS mode worker-mailer upgrades only when the server advertises STARTTLS. Without it, it continues in plain text, including AUTH.
- worker-mailer writes a non-ASCII subject as one unfolded Q-encoded word. The adapter sets the `Subject` header itself with folded RFC 2047 B-encoded words.
- Cloudflare blocks port 25, Cloudflare IP ranges, localhost and private IPs. A socket counts toward the 6 simultaneous connections per request.

## Slack incoming webhooks

- Source: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks, https://docs.slack.dev/changelog/2016-05-17-changes-to-errors-for-incoming-webhooks, https://docs.slack.dev/reference/block-kit/blocks
- `POST <webhook URL>` with JSON `{ text, blocks }`. The URL is the secret. Success is HTTP 200 with body `ok`.
- Errors are plain text: `invalid_payload` (400), `user_not_found` (400), `action_prohibited` (403), `channel_not_found` (404), `channel_is_archived` (410), `rollup_error` (500), and `no_service`, `no_text` without a documented status.
- Limits: 1 message per second per channel, then 429 with Retry-After. Section text 3000, 50 blocks, 10 context elements, button url 3000 and text 75.
- Slack docs say a url button still sends an interaction payload that expects an acknowledgement.
- Image block (checked 2026-11-19, https://docs.slack.dev/reference/block-kit/blocks/image-block): `{ type: "image", image_url, alt_text, title? }`. `alt_text` is required, max 2000; `image_url` must be publicly hosted, max 3000; `title` is `plain_text`, max 2000. Supported types: png, jpg, jpeg, gif. Incoming webhooks have no file upload, so other files go out as mrkdwn links.

## Discord webhooks

- Source: https://docs.discord.com/developers/resources/webhook, https://docs.discord.com/developers/topics/threads, https://docs.discord.com/developers/topics/opcodes-and-status-codes, https://docs.discord.com/developers/topics/rate-limits
- `POST <webhook URL>?wait=true` returns the message object (204 without `wait`). The URL is the secret.
- Forum channels: every post needs `thread_name` (creates a post) or `?thread_id=` (220001 without either, 220002 with both). `thread_name` only works in forum or media channels (220003).
- An archived thread unarchives on send unless a moderator locked it.
- `flags: 4096` (SUPPRESS_NOTIFICATIONS) is allowed on webhooks. `allowed_mentions: { parse: [] }` blocks all pings.
- Embed limits: title 256, description 4096, footer 2048, 6000 total. Content 2000.
- Errors: `{ code, message }`. 429 includes `retry_after` (float seconds) and the Retry-After header. Discord asks clients to stop using a webhook that returned 404.
- Verify: `GET <webhook URL>` needs no other auth and returns the webhook object.
- Files (checked 2026-11-19, https://docs.discord.com/developers/reference#uploading-files, https://docs.discord.com/developers/resources/webhook#execute-webhook, https://docs.discord.com/developers/resources/message#attachment-object-attachment-request-structure): `multipart/form-data` with `payload_json` (the JSON body) and `files[n]` parts, each with a `filename` in Content-Disposition. `attachments: [{ id: n, filename }]` in `payload_json`, where `id` matches the `n` in `files[n]`. An embed shows an uploaded image with `image.url = "attachment://<filename>"`.
- Upload limit: 20 MiB per file by default, higher with Nitro or server boosts. Error codes: 40005 (request entity too large), 50045 (file over the maximum size). The adapter sends the message again with links on 413, 40005, or 50045.

## ntfy

- Source: https://docs.ntfy.sh/publish/, https://docs.ntfy.sh/config/
- JSON publish: `POST <server root>` with `{ topic, title, message, priority (1-5), tags, click }`. Auth: `Authorization: Bearer tk_...`.
- Limits: message 4096 bytes by default (larger messages become attachments), title 1 KB, all tags 512 bytes (400 over either). Default rate limit: 60 requests per visitor, refilling 1 every 5 s.
- The adapter sends the tag `test_tube` on test messages and the topic key as a tag.
- Checked 2026-11-19 against https://docs.ntfy.sh/publish/ (source: https://github.com/binwiederhier/ntfy/blob/main/docs/publish.md).
- Attachment by URL: JSON fields `attach` (URL) and `filename`. The file is hosted elsewhere, so ntfy's attachment size and expiry limits (15 MB per file on ntfy.sh) do not apply. One attachment per message.
- Action buttons: "up to three user actions" per message, JSON `actions` array. `view` takes `label`, `url`, `clear`. `http` takes `label`, `url`, `method` (default `POST`), `headers`, `body`, `clear`; with `clear: true` the notification closes only when the request succeeds. Action buttons and `http` actions work on Android, iOS, and the web app. The phone sends the `http` request.

## Pushover

- Source: https://pushover.net/api
- `POST https://api.pushover.net/1/messages.json`, form: `token, user, message, title, priority, url, url_title, device, timestamp`.
- Priority -2 to 2. Priority 2 requires `retry` (at least 30 s) and `expire` (at most 10800 s); the adapter sends 60 and 1800.
- Limits: message 1024, title 250, url 512, url_title 100. Over the monthly quota returns 429. At most 2 concurrent connections.
- Errors: `status` other than 1, with an `errors` array and a `request` id.
- Verify: `POST /1/users/validate.json` with `token, user, device?`; `status: 1` means a valid user with an active device.
- Attachments (checked 2026-11-19, https://pushover.net/api#attachments): one image per message, at most 5,242,880 bytes. Send it as a multipart `attachment` part, or as `attachment_base64` with `attachment_type` (MIME type). Base64 makes the request about 35% larger. The adapter uses `attachment_base64`.

## Generic webhook (Beep Me format)

- `POST <url>` JSON `{ event: "notification", id, title, body, priority, topic, url, agent, silent, test, createdAt, attachments: [{ name, mime, size, url }], options, expect_reply, sender_name }`.
- Headers: `user-agent: BeepMe/0.1`, `X-BeepMe-Timestamp` (Unix seconds), and with a secret `X-BeepMe-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`.

## Not verified

- Telegram error text for a deleted forum topic. The adapter treats `thread not found`, `TOPIC_DELETED`, `TOPIC_ID_INVALID` and `topic not found` in `description` as a missing thread.
- The Bot API version that added private-chat topics (the brief says 9.4). The local 10.4 copy confirms the feature and does not say which version added it.
- Discord: that the `thread_name` response has `channel_id` equal to the new thread id (the docs say the starter message has the thread's id; the adapter stores `channel_id`, then `id`). Which code a locked or deleted thread returns (the adapter recreates on 10003 and 50083).
- Telnyx text length limit. Error 42202 says 1,600 characters; the encoding guide says 10 segments.
- Telnyx MMS size. The spec says less than 1 MB in total, error 42205 says 1 MB per file and 2 MB in total, and the transcoding guide lists carrier limits down to 600 KB. Beep Me uses 1 MB in total and retries with links on a 4xx.
- The host of Telnyx inbound media URLs. Beep Me sends the API key only to `telnyx.com` hosts and follows redirects without it.
- Whether `PATCH /phone_numbers/{id}/messaging` takes an E.164 number as `{id}`. Beep Me sends the number id.
- Whether Twilio accepts 204 from an incoming message webhook without a 12200 or 12300 warning. Beep Me returns empty TwiML.
- Twilio media retention: the docs say until deleted, the Help Center says 13 months.
- Resend error JSON shape (`{ statusCode, message, name }` is not shown in the docs).
- Gmail API maximum message size.
- Discord: the maximum number of files per message (the adapter sends at most 10) and the maximum total request size (the adapter keeps the upload at 20 MiB or less, then falls back to links on 413, 40005, or 50045).
- ntfy: a maximum length for action button labels. Beep Me options are at most 64 characters.
- Slack: the status code and error text when Slack cannot download an `image_url`. The adapter sends again without image blocks on any 400.
- ntfy error JSON shape (`{ code, http, error }` is not shown in the docs).
- Gmail app password changes in 2026.
- What `editMessageText` does with the inline keyboard when `reply_markup` is omitted. The adapter sends it again.
- Discord thread name limit of 100 characters (the adapter clips `thread_name` to 100).
- Twilio account `status` values (the adapter accepts only `active`).
- ntfy: the `test_tube` tag shows as an emoji, and the publish response has `id`.
- Pushover: the `timestamp` field and the `receipt` field in the priority 2 response.
- SMTP on 465 and 587 through `cloudflare:sockets` with real servers. No sanity run covered SMTP.
