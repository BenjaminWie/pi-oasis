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
