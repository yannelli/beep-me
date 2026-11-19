# Dashboard API

Created: 2026-11-18. Last updated: 2026-11-18.

The dashboard talks to the Worker over same-origin JSON under `/api`. The session cookie authenticates each request. Mutating requests send `content-type: application/json`. Errors return `{ "error": string, "fields"?: Record<string, string> }`. Types live in [`src/shared/api.ts`](../src/shared/api.ts).

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
| PATCH | `/api/topics/:id` | `{ muted: boolean }` | `TopicDTO` |
| POST | `/auth/logout` | | `{ ok: true }` |
| DELETE | `/api/account` | | `{ ok: true }` |

## Agent endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/mcp` | OAuth access token or `beep_` agent token | MCP Streamable HTTP endpoint |
| POST | `/v1/notify` | `Authorization: Bearer beep_…` | Send a notification from curl, CI, or cron |
