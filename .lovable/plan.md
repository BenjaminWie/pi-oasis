## What I verified

- Every enqueue path already fires a wake broadcast on the Realtime channel `commands:<device_id>` (`broadcast.server.ts`, used by `cloud.functions.ts`, `mcp-tools.server.ts`, `voice-intents.server.ts`, Telegram webhook).
- **Nothing subscribes to it.** `src/lib/cloud-bridge.server.ts` and `agent/index.mjs` both just loop with a 5 s sleep and hit `/api/public/agent/poll`. So we pay for ~17,000 worker invocations/day *and* still wait up to 5 s (plus a `devices` SELECT + a `last_seen_at` UPDATE on **every** poll — that's the Database slice in your usage chart).
- DB rows are genuinely low now (25–36 `device_events`/day, `mcp_audit` empty), which confirms the cost is wakeups, not data.
- Alexa: `alexa_oauth_token_log` is empty and `alexa_oauth_codes` has one unused row from Jul 25 → the linking dies on the consent leg, before the token endpoint is ever called.

## Plan

### 1. WebSocket command delivery (replaces polling)
- The Pi bridge opens **one** Supabase Realtime WebSocket and subscribes to `commands:<device_id>`. Idle cost: zero HTTP requests, zero DB queries.
- Carry the **full command** in the broadcast payload (`id`, `kind`, `payload`), not just a "wake" ping. The Pi executes immediately on message arrival and POSTs the result to `/api/public/agent/result`. Round trip becomes **sub-second** — press the button, pump runs.
- `/api/public/agent/poll` stays, but only as a **safety net every 15 min** (and once at startup, to drain anything queued while offline). Same endpoint for Node-RED users who can't hold a socket.
- Reconnect handling: on socket drop or resubscribe, do one catch-up poll, then go quiet again.
- Result: ~17,000 requests/day → ~100/day plus one per actual command.

### 2. Trim the per-request DB work that's left
- `poll.ts` writes `last_seen_at` on every call — with 15-min polling that's fine, but I'll also throttle it to at most once per 10 min so the safety-net poll and the heartbeat don't double-write.
- `/api/public/live/publish` does a `devices` lookup per tick. Cache `token hash → device_id` in the worker's memory (TTL ~10 min) so high-rate MQTT ticks stop touching Postgres, and make the throttle configurable (default 2 s instead of 500 ms).

### 3. Make the usage page show requests, not rows
- Add a small per-endpoint/per-day counter (one upserted row per endpoint per day) and display invocations by source on `/connections/usage`, so you can see the real cost driver even while sending little data. Keep the row sparklines as a secondary panel.

### 4. Alexa: instrument, then fix
- Log an `authorize` event into `alexa_oauth_token_log` at every exit of the consent flow: page opened, unknown client, redirect_uri mismatch (received vs. allowed), no session, approve clicked, code minted, denied.
- Show those rows in the Alexa page log so the next attempt pinpoints the stop.
- Fix the two issues already visible in code: `getAlexaConsent` returns `state: ""` instead of passing Alexa's `state` through, and an unauthenticated visitor in Alexa's in-app browser has no Supabase session, so the approve POST 401s and Alexa shows a generic error — the consent route will route through `/auth` preserving the full consent URL and return the user to it.

## Technical notes
- The Pi already has `@supabase/supabase-js` available; the bridge uses it with the publishable key plus the device token channel name — no service-role key on the Pi.
- Broadcast is fire-and-forget, so the safety-net poll remains the correctness guarantee; commands stay `pending` until the Pi acks them.
- Command payloads are small; if one ever exceeds the broadcast size limit, the Pi falls back to fetching it by id from `/api/public/agent/poll`.
- Realtime messages are cheap compared to worker invocations, and one long-lived socket per device stays well inside the Realtime allowance.
