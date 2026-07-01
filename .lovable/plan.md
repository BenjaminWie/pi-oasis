## Problem

Pump buttons in `/pump` enqueue `plugin_manual` with `runner: "nodered"`, and the cloud API correctly serves them to Node-RED via `?runner=nodered`. The chain that's missing/broken:

1. The downloadable `nodered-template.json` defines a `link out` (`7b01cb4bfe7639ba`) that expects a matching `link in` + hardware path the user must wire themselves. If they don't have it, pump never activates.
2. The pump UI gives no feedback when the command is enqueued but not picked up — looks "dead".
3. Telegram only supports `/plugin <name> <command>` (clumsy). No simple `/pump on 10`.
4. Alexa intents exist but no copy-pasteable Skill JSON + sample utterances are surfaced anywhere.
5. DB shows no `plugin_manual` rows in 2 days → the buttons may never have made it through; we should also show errors in UI.

## Goal

Start/Stop the pump from the cloud Pump page, Telegram, and Alexa — end-to-end, with feedback and a Node-RED template that actually drives the Tasmota relay.

## Plan

### 1. Self-contained Node-RED template (drives Tasmota directly)

Rewrite `public/nodered-template.json` so the Cloud-Bridge tab no longer relies on a user-provided `link in`. Add inside that tab:

- `link in` (id `7b01cb4bfe7639ba`) → receives `{ payload: "ON"|"OFF", minutes? }` from `Execute Pump/MQTT Command`.
- `function "Map to Tasmota cmnd"` → reads env `PUMP_MQTT_TOPIC` (default `cmnd/zisterne/POWER`) and `PUMP_MQTT_BROKER_ID`, sets `msg.topic` + `msg.payload`.
- `trigger` (auto-OFF after `msg.delay` ms, override + extend) → sends `OFF` after `minutes`.
- `mqtt out` configured against the existing local broker.
- A `status` debug + a `link out` (`zisterne_pump_state`) so users can fan-out.

Document `PUMP_MQTT_TOPIC` and `PUMP_MQTT_BROKER_ID` in `/integrations` envBlock and `docs/nodered-integration.md`.

### 2. Pump UI feedback + diagnostics

In `src/routes/_cloud/pump.tsx`:

- Add `useToast` notifications on `manualMut.onSuccess`/`onError` ("Befehl gesendet — wartet auf Node-RED" / error message).
- Add a small status strip under "Manuelle Steuerung" that shows last `plugin_manual`: `id`, `status`, age. If `status === "pending"` for >30s → amber warning: "Node-RED hat den Befehl nicht abgeholt. Token/URL in `/integrations` prüfen."
- "Test Node-RED" button → enqueues `status` with `runner: "nodered"` and reports back the result.

### 3. Simple Telegram pump commands

In `src/routes/api/public/telegram/webhook.$userId.ts`, before the existing `/plugin` block add `/pump`:

- `/pump on [minutes]` → enqueue `plugin_manual` `{ id: "pump", runner: "nodered", action: "on", minutes }` (default 10, cap 120).
- `/pump off` → `{ action: "off", runner: "nodered" }`.
- `/pump status` → enqueue `status` (existing path).
- Map common German voice intents already extracted by the OGG transcription path (`pumpe an`, `pumpe aus`, `pumpe für 10 minuten`) to the same enqueue path.
- Update `/help` text.

### 4. Alexa: surface Skill JSON & sample utterances

`src/routes/_cloud/connections.alexa.tsx`:

- Add a "Interaction Model" code-block (copy button) with the JSON intents/slots for `TurnOnPumpIntent` (with `Duration` AMAZON.NUMBER slot), `TurnOffPumpIntent`, `PumpStatusIntent`, including ~10 sample utterances each ("Alexa, sage Pi Hub Pumpe an für zehn Minuten" usw.).
- Link to https://developer.amazon.com/alexa/console/ask and to existing `/api/public/voice/alexa` endpoint + the bearer token.

Verify `alexa.ts` already passes `runner: "nodered"` (it calls `pump_set` → `enqueueAndWait("plugin_manual", { runner: "nodered", ... })` — confirmed).

### 5. Tiny safety net

- Pump UI: if no Node-RED has polled in last 5 min (use `devices.last_seen_at` from existing query — for now use `details?.last_seen_at`), show a one-line hint card linking to `/integrations`.

## Out of scope

- No DB migrations.
- No change to the polling endpoint / runner filter (works as designed).
- No change to MCP — already correct.

## Files

- `public/nodered-template.json` (rewrite Cloud-Bridge tab section for pump exec)
- `src/routes/_cloud/pump.tsx` (toast + status strip + test button + stale hint)
- `src/routes/api/public/telegram/webhook.$userId.ts` (add `/pump` + voice mapping + help)
- `src/routes/_cloud/connections.alexa.tsx` (Skill JSON + utterances)
- `docs/nodered-integration.md` (PUMP_MQTT_TOPIC, PUMP_MQTT_BROKER_ID, troubleshooting)
- `src/routes/_authenticated/integrations.tsx` (extend envBlock with pump vars)
