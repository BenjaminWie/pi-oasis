# Reduce DB credits, keep insights, visualize better

## Why the DB is expensive today

- **`device_events_hourly` is empty (0 rows) while `device_events` has 2 484 rows / 24 h ≈ 160 events/day.** The nightly rollup function `aggregate_device_events()` exists but `pg_cron` was never enabled, so every chart still scans raw rows.
- **Polling is aggressive:** pump page refetches every 5 s / 10 s / 30 s; DeviceAnalytics every 10 s / 60 s. Each poll runs a full raw-events query.
- **Node-RED emits a heartbeat every ~30 s even when nothing changes** → 90 % of rows are duplicates of the previous state.
- No daily rollup exists, so long-term insights force raw scans.

## Plan

### 1. Turn on real aggregation (biggest win)

- Migration: `CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net;`
- Schedule existing `aggregate_device_events()` **every 15 min** (not nightly) so charts read from `device_events_hourly` almost immediately.
- Schedule `recompute_anomaly_baselines()` hourly.
- Extend `aggregate_device_events()` to also compute: `pump_minutes`, `pump_cycles`, `pv_covered_minutes`, `kwh_est` per bucket.
- Tighten retention: raw `healthy` + `info` older than **48 h** → deleted (currently 7 d). `warning`/`critical` kept 30 d. Hourly kept 90 d.

### 2. New `device_events_daily` rollup

Columns: `device_id, day, pump_minutes, pump_cycles, kwh_est, pv_covered_pct, rain_mm, avg_outside_temp, warnings, criticals`. Populated by same cron from hourly. Kept forever (tiny: ~1 row/day).

### 3. Server-side dedup on ingest

In `/api/public/cloud-bridge/event.ts`:
- Look up last event for `(device_id, component, device_label)`.
- If `status` and rounded `metrics.watts` (±5 W) match and gap < 5 min → **update `occurred_at` + increment a `sample_count` column** instead of inserting.
- Insert a full row on state change or every 5 min max.
- Expected reduction: ~70 % fewer rows for `pump_control`/`eco_intelligence` heartbeats.

### 4. Slow down polling + read from rollups

- Pump page: 5 s → 15 s (state), 10 s → 30 s (events list), 30 s → 60 s (strategy).
- DeviceAnalytics events tab: 10 s → 30 s. Chart tab: 60 s → 300 s.
- Add `staleTime` on all queries so tab switches don't refetch.
- Chart queries read `device_events_hourly` / `device_events_daily`, not raw.

### 5. Better visualization (compact, insight-first)

Replace the current single "Watt-Verlauf" bar chart with a compact **Insights** block above the raw log (collapsible like Strategie), showing rollup-derived data only:

- **Today card**: pump minutes, cycles, kWh, PV-covered %.
- **7-day sparkline** (bars = daily pump minutes, colored by PV coverage).
- **24-h hourly strip** (watts avg, 24 tiny bars) — from hourly rollup.
- **Week × hour heatmap** (7×24 grid, cell = pump minutes) — one glance shows watering pattern.
- **Anomalies** line: μ ± σ badge, only shown if today deviates > 2σ.

Everything else (raw event log, strategy editor) stays behind existing collapsibles so the page height doesn't grow.

## Technical notes

- Migration adds: `pg_cron`, `pg_net`, `sample_count` column on `device_events`, `device_events_daily` table + GRANTs + RLS + owner-select policy, extended `aggregate_device_events()`, new `aggregate_device_events_daily()`, three `cron.schedule` calls, retention DELETE in the same function.
- New server fn `listDailyRollup(deviceId, days)` in `src/lib/control.functions.ts`.
- Ingest dedup uses `supabaseAdmin` upsert on a partial unique index `(device_id, component, device_label) WHERE occurred_at > now() - interval '5 minutes'` — or a simple `select … order by occurred_at desc limit 1` then update, which is fine at 160 events/day.
- New `<PumpInsights />` component in `src/routes/_cloud/pump.tsx` reading hourly + daily rollups; no new libs (SVG bars/heatmap inline, same style as existing chart).

## Expected impact

- Row inserts/day: ~160 → ~40 (dedup).
- Chart read cost: full-table scan → 24–168 row rollup reads.
- Polling load: roughly halved.
- Storage: `device_events` stays < 500 kB steady-state; daily table grows ~365 rows/year.

## Out of scope

- Node-RED flow changes (dedup done server-side so the Pi stays simple).
- Telegram / Alexa command changes.
- Any change to `agent_commands` or auth.
