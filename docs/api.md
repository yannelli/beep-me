# Dashboard API

Created: 2026-11-18. Last updated: 2026-11-18.

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
| GET | `/api/topics` | | `{ items: TopicDTO[] }` |
| GET | `/api/media/:interaction/:index` | | A file the user sent back, streamed through the channel |
| POST | `/api/integrations/telnyx/account` | `{ apiKey } \| { channelId }` | `TelnyxAccountDTO` (numbers and messaging profiles) |
| GET | `/api/integrations/telnyx/channels/:id` | | `TelnyxSetupDTO` (number, profile, reply webhook, public key, 10DLC or toll-free status) |
| POST | `/api/integrations/telnyx/channels/:id/plan` | `TelnyxAction` | `TelnyxPlanDTO`. Changes nothing in Telnyx. |
| POST | `/api/integrations/telnyx/channels/:id/actions` | `TelnyxAction & { confirm: true }` | `TelnyxSetupDTO`. Without `confirm: true`: 409 `{ error, plan }` and no change. |
| * | `/api/integrations/resend/*` | | Resend domains and inbound email setup |
| PATCH | `/api/topics/:id` | `{ muted: boolean }` | `TopicDTO` |
| POST | `/auth/logout` | | `{ ok: true }` |
| DELETE | `/api/account` | | `{ ok: true }` |

## Agent endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/mcp` | OAuth access token or `beep_` agent token | MCP Streamable HTTP endpoint |
| POST | `/v1/notify` | `Authorization: Bearer beep_…` | Send a notification from curl, CI, or cron |
| GET | `/v1/replies` | `Authorization: Bearer beep_…` | Read answers to this agent's messages, with optional waiting |
| GET | `/v1/media/:interaction/:index` | `Authorization: Bearer beep_…` | A file the user sent back to this agent |

## Public and webhook endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/media/:id/:name` | Files agents uploaded, for 7 days. The id is 32 random characters. |
| POST | `/hooks/telegram/:channel` | Telegram updates, checked with a per-channel secret |
| POST | `/hooks/sms/:delivery/:signature` | Twilio and Telnyx delivery receipts |
| POST | `/hooks/telnyx/:channel/:token` | Inbound Telnyx texts and MMS. Checked with the channel token and the Ed25519 signature. |
| POST | `/hooks/sms/twilio/:channel/:token` | Inbound Twilio texts and MMS. Checked with the channel token and `X-Twilio-Signature`. |
| POST | `/hooks/resend/*` | Inbound email from Resend |
