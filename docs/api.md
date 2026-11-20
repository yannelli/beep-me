# Dashboard API

Created: 2026-11-18. Last updated: 2026-11-19.

The dashboard talks to the Worker over same-origin JSON under `/api`. The session cookie authenticates each request. Mutating requests send `content-type: application/json`. Errors return `{ "error": string, "fields"?: Record<string, string> }`. Types live in [`src/shared/api.ts`](../src/shared/api.ts). Telnyx setup types live in [`src/shared/telnyx-setup.ts`](../src/shared/telnyx-setup.ts).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/api/session` | | `SessionResponse` (no sign-in needed) |
| GET | `/api/me` | | `MeResponse` |
| PATCH | `/api/settings` | `SettingsPatch` | `MeResponse` |
| POST | `/api/pause` | `{ minutes: number \| null }` (null resumes) | `MeResponse` |
| GET | `/api/channels` | | `{ items: ChannelDTO[] }` |
| POST | `/api/channels` | `CreateChannelBody` | `ChannelDTO` |
| GET | `/api/channels/:id` | | `ChannelDTO` |
| PATCH | `/api/channels/:id` | `UpdateChannelBody` | `ChannelDTO` |
| DELETE | `/api/channels/:id` | | `{ ok: true }` |
| POST | `/api/channels/:id/test` | `{ target?: "main" \| "topic" }` | `TestResult` |
| POST | `/api/channels/:id/telegram/link` | `{ purpose: "main" \| "topics" }` | `TelegramLink` |
| GET | `/auth/gmail/start?channel=:id` | | Redirect to Google, then back to `/channels/:id` |
| GET | `/api/agents` | | `{ items: AgentDTO[] }` |
| POST | `/api/agents` | `CreateAgentBody` | `{ agent: AgentDTO, token: string }` |
| PATCH | `/api/agents/:id` | `UpdateAgentBody` | `AgentDTO` |
| POST | `/api/agents/:id/revoke` | | `AgentDTO` |
| POST | `/api/agents/:id/rotate` | | `{ agent: AgentDTO, token: string }` (token agents) |
| DELETE | `/api/agents/:id` | | `{ ok: true }` |
| GET | `/api/messages?before&agent&status&priority&topic&limit` | | `MessagePage` |
| GET | `/api/messages/:id` | | `MessageDTO` |
| POST | `/api/messages/test` | `SendTestBody` | `MessageDTO` (full pipeline, sender "Beep Me") |
| POST | `/api/messages/:id/answer` | `{ option?: number, text?: string }` | `MessageDTO`. Records a dashboard answer (`matchedBy: "dashboard"`). |
| POST | `/api/messages/:id/ack` | | `MessageDTO`. Records a 👍 from the dashboard and cancels the waiting fallback steps. |
| POST | `/api/messages/:id/fallbacks/cancel` | | `MessageDTO`. Cancels the waiting fallback steps. |
| GET | `/api/topics` | | `{ items: TopicDTO[] }` |
| GET | `/api/media/:interaction/:index` | | A file the user sent back, streamed through the channel |
| POST | `/api/integrations/telnyx/account` | `{ apiKey } \| { channelId }` | `TelnyxAccountDTO` (numbers and messaging profiles) |
| GET | `/api/integrations/telnyx/channels/:id` | | `TelnyxSetupDTO` (number, profile, reply webhook, public key, 10DLC or toll-free status) |
| POST | `/api/integrations/telnyx/channels/:id/plan` | `TelnyxAction` | `TelnyxPlanDTO`. Changes nothing in Telnyx. |
| POST | `/api/integrations/telnyx/channels/:id/actions` | `TelnyxAction & { confirm: true }` | `TelnyxSetupDTO`. Without `confirm: true`: 409 `{ error, plan }` and no change. |
| GET | `/api/integrations/resend/:channel` | | `ResendSetupState` (saved domain, webhook URL and status, key error) |
| GET | `/api/integrations/resend/:channel/domains` | | `{ items: ResendDomainSummary[] }` |
| GET | `/api/integrations/resend/:channel/domains/:domain` | | `ResendDomainDetail` (records, Cloudflare zone check, zone file) |
| POST | `/api/integrations/resend/:channel/domains` | `ResendCreateDomainBody` | `ResendDomainDetail` (sending and receiving on) |
| POST | `/api/integrations/resend/:channel/domains/:domain/receiving` | `{ confirm }` | `ResendDomainDetail` |
| POST | `/api/integrations/resend/:channel/domains/:domain/verify` | `{ confirm }` | `ResendDomainDetail` |
| POST | `/api/integrations/resend/:channel/domains/:domain/use` | `{ confirm }` | `ResendDomainDetail`, saves the agent domain on the channel |
| POST | `/api/integrations/resend/:channel/webhook` | `{ confirm }` | `{ ok, webhookId }`, creates or reuses the `email.received` webhook and saves its secret |
| PATCH | `/api/topics/:id` | `{ muted: boolean }` | `TopicDTO` |
| POST | `/auth/logout` | | `{ ok: true }` |
| DELETE | `/api/account` | | `{ ok: true }` |

Every Resend setup POST without `confirm: true` changes nothing and returns 409 `ResendPreview` (`{ error, preview: { method, path, body, summary } }`). Types are in `src/shared/resend.ts`.

## Agent endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/mcp` | OAuth access token or `beep_` agent token | MCP Streamable HTTP endpoint. With `X-Beep-Me-Plugin: 1` (sent by `plugins/beep-me`), `notify` text for a question says the plugin waits, in place of the watch loop. |
| POST | `/v1/notify` | `Authorization: Bearer beep_…` | Send a notification from curl, CI, or cron |
| GET | `/v1/replies` | `Authorization: Bearer beep_…` | Read answers to this agent's messages, with optional waiting |
| GET | `/v1/media/:interaction/:index` | `Authorization: Bearer beep_…` | A file the user sent back to this agent |
| POST | `/v1/messages/:id/fallbacks/cancel` | `Authorization: Bearer beep_…` | `{ canceled }`. Stops the waiting fallback steps of this agent's message, like `cancel_fallbacks`. 404 for another agent's message. |
| GET | `/v1/watch/:message/:signature?wait_seconds` | The signed URL from `notify.watch_url` | `{ message_id, ready, count, waited_seconds }`. Waits up to 50 seconds for an unread answer. Returns no answer text. 401 when the agent was revoked. |

`/v1/notify` and the MCP `notify` tool take the same body, including `channels`, `topic_thread`, and `fallbacks`. Fallback steps live in the `fallbacks` table (migration `0003`) and show on `MessageDTO.fallbacks`.

## Public and webhook endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/media/:id/:name` | Files agents uploaded, for 7 days. The id is 32 random characters. |
| POST | `/hooks/telegram/:channel` | Telegram updates, checked with a per-channel secret |
| POST | `/hooks/sms/:delivery/:signature` | Twilio and Telnyx delivery receipts |
| POST | `/hooks/telnyx/:channel/:token` | Inbound Telnyx texts and MMS. Checked with the channel token and the Ed25519 signature. |
| POST | `/hooks/sms/twilio/:channel/:token` | Inbound Twilio texts and MMS. Checked with the channel token and `X-Twilio-Signature`. |
| POST | `/hooks/resend/:channel` | Inbound email from Resend (`email.received`), checked with the Svix signature and the channel's signing secret |
