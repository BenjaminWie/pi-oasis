# Hosted MCP Server for Pi-Hub

Expose your pump, plugins, MQTT and events to any AI (ChatGPT, Gemini, Claude, Alexa, Google Assistant) through one secure, hosted MCP endpoint in the Lovable Cloud. The MCP server never talks to the Pi directly — it enqueues commands into the existing `agent_commands` queue that your Pi already long-polls, so we reuse all current security boundaries and add no new inbound ports on the Pi.

## Architecture

```text
ChatGPT / Gemini / Claude Desktop ─┐
Alexa Skill / Google Action       ─┼─► https://pi-hub.benniwie.com/api/mcp
Any MCP client                    ─┘        │ (Bearer <mcp_token>)
                                            ▼
                              Lovable Cloud MCP server
                                            │  validates token → resolves device
                                            ▼
                              agent_commands (Supabase, RLS)
                                            │
                                            ▼
                              Pi long-poll  → executes → posts result
                                            │
                                            ▼
                              MCP tool returns result to caller
```

## What gets built

### 1. Secure hosted MCP endpoint
- New route `src/routes/api/mcp.ts` using `mcp-tanstack-start` (`POST` only, `GET`/`DELETE` → 405).
- `withMcpAuth` extractor reads `Authorization: Bearer <token>`, looks the token up in a new `mcp_tokens` table (hashed with scrypt, like the PIN store), and resolves `{ userId, deviceId, scopes }`. No token → null → 401.
- All tool executions go through one helper that enqueues an `agent_commands` row for the resolved device and waits up to ~25 s for the Pi to post the result (reuses `result.ts`). Timeouts return a structured "pi_offline" error instead of hanging the model.
- Every call is written to a new `mcp_audit` table (tool name, args hash, latency, status) so you can review what any AI did.

### 2. MCP tools exposed
Read-only (safe by default):
- `list_plugins`, `get_plugin(id)` — current config, plan, last decisions
- `get_pump_status` — last MQTT state, runtime today, daily cap remaining
- `get_weather_plan(plugin_id)` — current AI plan + rationale
- `list_recent_events(limit)` — from the in-memory ingest buffer / `device_events`
- `list_containers`, `get_host_info`

Write (require `scope: control` on the token):
- `set_pump(state, duration_s?)` — manual override with safety clamp (max 600 s)
- `update_plugin_config(id, patch)` — validated via existing `validateConfig`
- `run_planner_now(plugin_id)` — triggers fresh AI plan
- `mqtt_publish(topic, payload)` — restricted to an allow-list of topics per device
- `create_smart_pump(config)`

Each tool's Zod schema is the contract the AI sees. Inputs are validated server-side again before enqueueing.

### 3. Per-user token management UI
- New page `src/routes/_cloud/mcp.tsx`:
  - "Create MCP token" → choose device + scopes (`read`, `control`), optional expiry.
  - Shows the token **once**, then only a prefix + last-used timestamp.
  - Copy buttons for: raw token, ChatGPT custom-GPT MCP config snippet, Claude Desktop `claude_desktop_config.json` snippet, Gemini function-calling base URL.
  - Revoke / rotate.
- Audit log viewer (last 200 MCP calls, filter by tool/status).

### 4. Voice bridges
Two thin adapters that translate voice-platform requests into MCP tool calls, so we don't duplicate business logic:

- **Alexa Custom Skill** — `src/routes/api/public/voice/alexa.ts`
  - Verifies Alexa request signature + timestamp (per Amazon's published cert chain).
  - Account linking uses the same MCP token (entered once in the Alexa app) → resolves device.
  - Intents: `TurnOnPumpIntent` (with optional `duration` slot), `TurnOffPumpIntent`, `PumpStatusIntent`, `WaterPlanIntent` → mapped to MCP tools.
  - Returns SSML responses ("Pump running for 2 minutes").

- **Google Assistant / Home** — `src/routes/api/public/voice/google.ts` with a Conversational Action webhook (same pattern, Google OAuth account linking → token).

- **Telegram voice** already exists; we extend its intent map to call the same internal tool helpers, so voice → Telegram → MCP-equivalent path is consistent.

### 5. Safety rails
- Per-token rate limit (token-bucket in memory + persisted counter): default 30 calls/min, 5 control calls/min.
- Control tools require an explicit `confirm: true` flag when `duration_s > 120` or topic isn't in allow-list.
- Daily pump-runtime cap from the smart-pump plugin is enforced server-side; MCP `set_pump` cannot exceed it.
- All secrets (`MCP_*`) live as Lovable Cloud secrets, never in the client bundle.
- HTTPS only (Lovable hosts it), CORS locked to allow only the MCP `POST` content-types.
- No service-role key ever crosses the MCP boundary; everything goes through the user-scoped Supabase client + RLS.

### 6. Docs
- `docs/mcp.md` with copy-paste configs for: ChatGPT (custom GPT → "MCP server" connector), Claude Desktop, Gemini (function calling / Extensions), Alexa skill setup, Google Action setup.
- README pointer + a "Connect an AI" CTA on the cloud dashboard.

## Database

New migration:
- `mcp_tokens(id, user_id, device_id, name, token_hash, scopes text[], expires_at, last_used_at, created_at)` — RLS: owner read/insert/delete, no update of `token_hash`.
- `mcp_audit(id, user_id, device_id, token_id, tool, status, latency_ms, error, created_at)` — RLS: owner read-only; inserts via service role from the MCP route.
- Both with `GRANT`s for `authenticated` (and `service_role` for inserts) per project rules.

## Out of scope (ask if you want them)
- Streaming SSE responses from MCP tools (current plan returns final result only).
- Public marketplace listing of the MCP server.
- Multi-device fan-out in a single tool call.

## Open question
Default token scope when you create one in the UI: **read-only** (safer, you opt-in to control per token) or **read + control** (one token does everything)? I'll go with read-only by default unless you say otherwise.
