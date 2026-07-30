## What I can see

**Alexa — verified from the live database, not guessed:**

- `alexa_oauth_token_log` has exactly **one** row from your attempt at **18:35 today**: `event: authorize`, `ok: true`, note `code issued → https://layla.amazon.com/api/skill/link/M26GRY8SJLYHDD`. So consent, login, redirect-URI allowlist and code minting all work now. That part is fixed.
- There is **no `token` event at all** — and `alexa_oauth_codes` contains only an old row from July 25. Today's code was created and then **disappeared**.
- The token endpoint is reachable in production (a manual POST returns a clean `401 invalid_client` JSON).

Cause, from reading the code against the real schema: in `/api/public/oauth/token`, the handler **deletes the code first**, then calls `mintAccessToken()`, which inserts into `mcp_tokens`. That insert omits `token_prefix`, which is `NOT NULL` in the table, and passes `device_id` which is also `NOT NULL` but can be null for a client without a bound device. The insert throws → the request 500s → Alexa shows "Konto konnte nicht verknüpft werden" → and because the throw happens after the delete and before the log write, no `token` row is ever recorded. That is exactly the pattern in the data.

**Docs:** correct, they were not updated. `docs/nodered-integration.md` still describes the 5-second polling model and never mentions `/api/public/agent/realtime`, the `commands:<device_id>` channel, or how Node-RED / the Pi should connect over WebSocket.

## Plan

### 1. Fix the Alexa token exchange (the actual blocker)
- In `mintAccessToken`: set `token_prefix` from the generated token, and make `device_id` fall back to the client's bound device or the user's only paired device; if the column truly must stay non-null and no device exists, fail with a clear `invalid_grant` instead of a 500.
- Reorder the exchange: validate → mint token → **then** mark the code used (`used_at`) instead of deleting it up front, so a failure never destroys the code.
- Wrap the whole POST handler in try/catch that logs `event: "token", ok: false, error_code: "server_error"` with the message, and returns RFC-shaped `{"error":"server_error"}`. No failure path may be silent again.
- Same treatment for the `refresh_token` grant.
- After deploy: re-link in the Alexa app; `/connections/usage` and the log table will then show a `token` row either way.

### 2. Migration
Relax `mcp_tokens.device_id` to nullable (Alexa clients can be account-scoped, not device-scoped) and give `token_prefix` a safe default, so this class of failure can't recur.

### 3. Rewrite `docs/nodered-integration.md` for the current architecture
New/updated sections:
- **Command delivery over WebSocket** — replace the polling description. Document `GET /api/public/agent/realtime` with the bearer device token, the response fields (`supabaseUrl`, `supabaseKey`, `deviceId`, `channel`, `safetyNetPollMs`), the channel name `commands:<device_id>`, the `wake` event shape with the inline command payload, and the 15-minute safety-net poll.
- **Node-RED wiring** — how to subscribe with a websocket-in node (URL `wss://<supabase-url>/realtime/v1/websocket?apikey=<key>&vsn=1.0.0`, the `phx_join` on `realtime:commands:<device_id>`, heartbeat every 30s), plus the fallback path using `GET /api/public/agent/poll?runner=nodered`.
- **Address table** — one clear table of every endpoint and its exact URL under `https://pi-hub.benniwie.com`: live publish, cloud-bridge event, strategy, agent realtime/poll/result/heartbeat, MCP, Alexa authorize/token.
- **Push rate guidance** matching the current throttles (live tick 1/s, server-side `LIVE_PUBLISH_THROTTLE_MS` 2s, sessions/alarms only on change).
- Remove the stale "poll every 5s" and duplicate section numbering (there are currently two "## 6" headings).

### 4. Update `public/nodered-template.json`
Add a documented WebSocket-command subflow alongside the existing safety-net poll, using the same env names already in the doc (`CLOUD_DEVICE_TOKEN`, `CLOUD_BRIDGE_URL`, `CLOUD_LIVE_URL`), and bump the in-flow comment nodes to describe the new flow.

### 5. Surface the addresses in the app
Extend `/integrations` (Pi) and the device page's Node-RED help so the realtime bootstrap URL and channel name are copyable, not doc-only.

## Technical notes
Files touched: `src/routes/api/public/oauth/token.ts`, one Supabase migration, `docs/nodered-integration.md`, `public/nodered-template.json`, `src/lib/integrations.functions.ts` (+ its route). No change to the broadcast helper or the Pi bridge — those are already correct.
