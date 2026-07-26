
Four independent tracks. All in cloud UI + server; nothing changes on the Pi runtime.

## 1) Alexa: one step further, still failing

State: Consent + Approve now works (the earlier HTML-instead-of-JSON bug is gone). The current failure ("Konto konnte nicht mit Alexa verknüpft werden") happens *after* our redirect back to Alexa, i.e. during Alexa's server-to-server call to `/api/public/oauth/token`. We have zero visibility into that call today.

Diagnosis + fixes:
- Add structured logging to `src/routes/api/public/oauth/token.ts`: log grant_type, client_id (masked), whether Basic vs body creds arrived, redirect_uri match result, and the outgoing response body — so the next Alexa attempt leaves a trace we can read via edge logs.
- Persist token-exchange attempts to a new `alexa_oauth_token_log` table (event, client_id, ok/error, error_code, ts). Show the last 20 attempts in `/connections/alexa` so the user sees "Alexa hit /token at 17:52 → invalid_grant" without needing server logs.
- Fix two spec-compliance risks that commonly trigger Alexa's generic error:
  - Response header `Cache-Control: no-store` and `Pragma: no-cache` on token responses (RFC 6749 §5.1 — Alexa rejects cacheable token responses).
  - Return `expires_in` as a JSON number ≤ 3600 for the *access token portion Alexa stores*; keep the internal 30-day validity but advertise 3600s so Alexa refreshes via `refresh_token` (many Amazon regions silently fail linking when `expires_in` is very large).
- Add a "Test Token Exchange" button in `/connections/alexa` that simulates Alexa's POST with a freshly-minted throwaway code, so we can prove the endpoint end-to-end without reopening the Alexa app.

Not changed: consent page, code minting, client registration — those already work.

## 2) Assistant chat: "AI is not authorized"

Root cause candidates verified by reading `src/routes/api/public/../../api/chat.ts` and `connections.assistant.tsx`:
- `/api/chat` returns plain `"Unauthorized"` / `"No paired device"` / `"messages required"` as `text/plain`, and the AI SDK surfaces that as `error.message`. Any of these look like "not authorized" in the UI.
- The client sends `Authorization: Bearer <token>` only if session already loaded. On a fresh tab the first send can race the session fetch.
- Gateway log check for the last 7 days: **0 requests** — chat has never reached the model, meaning we bail out inside the route before calling `brainStream`.

Fixes:
- Return structured JSON errors from `/api/chat` (`{ error, code }`) with proper status; surface `code` in the UI (e.g. `no_paired_device` → "Verbinde erst einen Pi", `unauthorized` → "Bitte neu anmelden").
- Log the exact bail-out reason server-side (already have `console.warn` pattern elsewhere).
- Assistant page: block submit until `token && ready`, and add a visible banner with the concrete reason when `error` is set.
- Add a lightweight `/api/chat/preflight` GET that returns `{ ok, userId, deviceId, reason? }` so the page shows the real blocker on mount instead of only after the first send.

## 3) Token / credits dashboard

New page `/connections/usage` (linked from Connections index):
- **Lovable AI Gateway usage** (this is the "tokens" cost driver): server function calls `credits--get_credit_balance` via a proxy `createServerFn`, plus a per-day chart from `list_ai_gateway_requests` grouped by day and by `model_type` (chat vs image). Shows total credits used today / 7d / 30d and cost per channel by inspecting the request's `X-Lovable-AIG-Run-ID` we already forward.
- **DB egress proxy**: count rows written per day from `mcp_audit`, `telegram_audit`, `device_events`, `pump_sessions` — this is our "Zero-Wake" health meter, tracks the 0.5-credit/day target we're aiming for.
- **Per-channel breakdown**: rows grouped by `source` (chat vs telegram vs alexa vs mcp) using the `mcp_tokens.source` column plus `mcp_audit.token_id` join.
- Small warnings when today's projected usage > yesterday's × 2.

Server functions only; no new Pi load. Reads through `requireSupabaseAuth`.

## 4) Short-cycle & fault warnings

Data already exists in `pump_sessions` (duration_s, kwh, trigger) and `device_events` (component, status, message).

Add:
- SQL function `detect_pump_anomalies(device uuid, window interval)` returning rows for: (a) `short_cycle` = ≥3 sessions in 10 min where each `duration_s < 60`, (b) `stuck_on` = session with `duration_s > 15*60` still open, (c) `no_flow` = session ended with `avg_watts < X` while pump was commanded on, (d) `fault_event` = any `device_events.status='error'` in last 24h.
- New table `alerts` (id, device_id, kind, severity, first_seen, last_seen, count, acknowledged_at). A cron-triggered edge callback (via existing `/api/public/hooks/anomaly-scan.ts` pattern) runs the function every 5 min and upserts alerts. No new Pi wakes — pure cloud read of already-buffered data.
- UI: red banner on `/devices/$id` and `/overview` when unacknowledged high-severity alerts exist, with a "Bestätigen" button that sets `acknowledged_at`. Alert list section on the device page grouped by kind, with the last 5 sessions inline.
- Telegram: optional push on new `high` alert via the already-wired bot (opt-in toggle on the device settings page). Zero-wake — cloud-originated, doesn't poll the Pi.

## Technical details

- New migration: `alerts`, `alexa_oauth_token_log`, `detect_pump_anomalies()` SQL function; all with GRANTs and RLS scoped to `auth.uid()` via `device.user_id`.
- New server fns: `getUsageSummary`, `getAlerts`, `acknowledgeAlert`, `simulateAlexaTokenExchange`, `chatPreflight`.
- New routes: `src/routes/_cloud/connections.usage.tsx`, alert banners in existing device routes.
- Edits: `src/routes/api/public/oauth/token.ts` (headers, logging, `expires_in`), `src/routes/api/public/../api/chat.ts` (JSON errors), `src/routes/_cloud/connections.assistant.tsx` (preflight + banner).
- No changes to `agent/`, plugin runner, or MQTT paths.

## Open questions before build

1. For the Alexa `expires_in`, OK to advertise 3600s to Alexa while we keep the internal 30-day token (Alexa will just refresh hourly)? This is the safest fix but slightly increases refresh traffic.
2. Should short-cycle alerts also *stop* the pump automatically, or only warn?
3. Telegram push on alerts — default on or opt-in?
