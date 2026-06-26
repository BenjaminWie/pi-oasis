# Plugins + Smart Pump (reference plugin)

Introduce a plugin system on pi-hub. Ship one reference plugin — **Smart Pump** — that decides when to switch a Tasmota plug on/off based on weather data the cloud AI fetches. Use a hybrid loop: cloud builds a plan, Pi executes it locally. Include a simulator so it works before any hardware is wired.

## User-visible surface

1. New bottom-nav entry **Plugins** → `/plugins` listing installed plugins with status (running, last decision, next check).
2. `/plugins/$id` plugin detail page:
   - Live state header (current plan, next evaluation in Xs, manual **Run now** / **Force ON 10 min** / **Force OFF** buttons).
   - **Decision timeline** — newest first, one row per evaluation: timestamp, action (ON / OFF / SKIP), one-line AI reason ("Skip — 6mm rain forecast next 12h"), expandable to show the inputs used.
   - Chart strip: last 24h plug state + weather snapshot (rain mm, temp), pulled from InfluxDB.
   - Config form: MQTT topic for the plug (`cmnd/<device>/POWER`, `stat/<device>/POWER`), location (lat/lon), max minutes per day, min hours between runs, dry-run toggle.
   - **Simulator** panel — flip "Simulated plug" on to bypass MQTT publish; the plugin logs decisions and pretends the plug toggled. Used to test without the broker/plug.
3. `/plugins` "Add plugin" button — for v1 just instantiates the Smart Pump template; the registry is built so more can be added later.
# Hosted MCP Server for Pi-Hub

Expose your pump, plugins, MQTT and events to any AI (ChatGPT, Gemini, Claude, Alexa, Google Assistant) through one secure, hosted MCP endpoint in the Lovable Cloud. The MCP server never talks to the Pi directly — it enqueues commands into the existing `agent_commands` queue that your Pi already long-polls, so we reuse all current security boundaries and add no new inbound ports on the Pi.

## Architecture

```text
Cloud (every 6h or on demand)
  └─ pump-planner serverFn  ──►  Lovable AI + websearch (weather)
                                  │
                                  ▼
                          plugin_plans row (JSONB plan: windows, thresholds, ttl)
                                  │
                          cloud bridge long-poll
                                  ▼
Pi runtime (every 60s)
  └─ plugin-runner ── reads active plan ── checks current MQTT state ──
                      decides ON/OFF/SKIP ── publishes via MQTT (or sim) ──
                      writes decision row + Influx point
```

- **Plan** is a small JSON the cloud AI emits: allowed run windows today, max minutes, abort conditions ("rain >2mm in next 6h cancels"), and a one-line `rationale`. Pi only evaluates this plan + live readings — no AI call on the Pi.
- **Decisions** are local to the Pi and mirrored to the cloud via the existing bridge so the timeline works from anywhere.

## Backend (Lovable Cloud)

New tables (with proper GRANTs + RLS scoped to `auth.uid()`):

- `plugins` — id, user_id, kind (`smart_pump`), name, config jsonb, enabled, created_at.
- `plugin_plans` — id, plugin_id, plan jsonb, rationale text, valid_until, created_at.
- `plugin_decisions` — id, plugin_id, decided_at, action (`on|off|skip|manual_on|manual_off`), reason text, inputs jsonb, simulated bool.

Server functions (`src/lib/plugins.functions.ts`):

- `listPlugins`, `getPlugin`, `createPlugin`, `updatePluginConfig`, `deletePlugin`.
- `runPumpPlanner({ pluginId })` — cloud-side, calls Lovable AI (`google/gemini-3-flash-preview`) with a websearch tool that pulls Open-Meteo forecast for the configured lat/lon (no key needed). Writes `plugin_plans` row.
- `listDecisions({ pluginId, limit })` — for timeline.
- `manualAction({ pluginId, action })` — writes a `manual_*` decision the Pi runner picks up on next tick.

## Pi runtime

New `src/lib/plugin-runner.server.ts` started from `pi-runtime.server.ts`:

- Tick every 60s for each enabled plugin owned by the paired user.
- Smart pump tick: load latest valid plan → read `stat/<topic>/POWER` (cached from MQTT subscription) → apply plan rules + manual overrides → publish `cmnd/<topic>/POWER ON|OFF` unless `simulated`.
- Writes decision row via cloud bridge; writes a point to local InfluxDB (`pi_hub` bucket, measurement `pump`, fields `state`, `reason_code`).

## Node-RED (optional, gated)

Out of scope to "inject flows" in v1 — too much surface area for the first cut. We expose a stub: if Node-RED admin API is reachable on the Pi, the plugin detail page shows a "Open in Node-RED" button that deep-links to the flow editor. Actual flow injection lands in a follow-up once the core loop is proven.

## Simulator (so we can ship without hardware)

- Plugin config has `simulated: true` by default.
- When set, plugin-runner skips MQTT publish, instead toggles an in-memory `simState`, and the UI's "current state" row reads from a server fn that returns simulated state if no MQTT broker is configured.
- Lets us demo the full timeline + AI plan flow today.

## Install script

Extend `scripts/install.sh` to detect Mosquitto / InfluxDB / Node-RED and print a "missing — run `apt install ...`" hint per service. No auto-install in this pass.

## Out of scope (follow-ups)

- Node-RED flow injection.
- Generic rule-builder plugin kind.
- Multi-plug / zone support.
- Soil moisture or other sensor inputs.
- Plugin marketplace / 3rd-party plugins.

## Technical notes

- Weather: Open-Meteo `https://api.open-meteo.com/v1/forecast?...&hourly=precipitation,temperature_2m` — free, no key. Called from the cloud planner only.
- AI: Lovable AI Gateway via existing pattern; structured output for the plan (`Output.object` with a tight Zod schema).
- Manual buttons write a `manual_*` decision row with `valid_until = now()+10min`; runner honors the latest unconsumed manual action before evaluating the plan.
- All MQTT topic + lat/lon inputs validated server-side (Zod) before persisting.
- Files touched/created:
  - new: `src/routes/_authenticated/plugins.tsx`, `src/routes/_authenticated/plugins.$id.tsx`, `src/lib/plugins.functions.ts`, `src/lib/plugin-runner.server.ts`, `src/lib/weather.server.ts`, `supabase/migrations/<ts>_plugins.sql`.
  - edited: `src/components/BottomNav.tsx`, `src/lib/pi-runtime.server.ts` (boot the runner), `scripts/install.sh` (service detection).
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
