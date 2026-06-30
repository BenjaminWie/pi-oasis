## Plan: Enable enhanced pump analytics (DB + integration verification)

### 1. Database migration
Extend `device_events_hourly` and the `aggregate_device_events()` function to store the eco-intelligence metrics Node-RED already sends.

- `ALTER TABLE public.device_events_hourly` — add columns:
  - `temp_avg numeric` (from `metrics.outside_temp`)
  - `rain_sum numeric` (from `metrics.precipitation_mm`)
  - `pv_surplus_avg numeric` (from `metrics.pv_surplus_watt`)
  - `pumping_allowed_ratio numeric` (from `metrics.pumping_allowed` 0/1)
- Replace `public.aggregate_device_events()` with the version that:
  - Coalesces `watts` / `watt` so both Pi-agent and Node-RED `pump_guard` work.
  - Computes `avg(outside_temp)`, `sum(precipitation_mm)`, `avg(pv_surplus_watt)`, `avg(pumping_allowed)`.
  - Keeps the 7-day prune of `healthy` events.
  - Updates the `ON CONFLICT` block to overwrite the new columns.

No new tables, so no GRANT/RLS changes required.

### 2. Verify integration with existing code
After the migration is approved, confirm the pieces already in the repo line up:

- `src/lib/control.functions.ts` → `listEventBuckets` must already select `temp_avg, rain_sum, pv_surplus_avg, pumping_allowed_ratio` (the Pump UI in `src/routes/_cloud/pump.tsx` already reads these keys). If the select list is still the old shape, widen it.
- `src/routes/api/public/cloud-bridge/event.ts` → confirm the `watts` normalization (`metrics.watt ?? metrics.house_power → metrics.watts`) is in place so the new `watts_avg/max/min` populate from both sources.
- `src/routes/api/public/hooks/aggregate-events.ts` cron hook → no code change; it just calls the updated RPC.
- `public/nodered-template.json` & `docs/nodered-integration.md` → no edits, the metric keys already match (`outside_temp`, `precipitation_mm`, `pv_surplus_watt`, `pumping_allowed`).
- Sanity-check the Pump page chart toggles (`watts / pv / temp / rain / allowed`) render with the new bucket fields.

### 3. Out of scope
- No frontend redesign — chart, toggles, and strategy form stay as they are.
- No Node-RED flow changes — the user confirmed payload keys are compatible.
- No new MCP tools or auth changes.

### Technical detail
Single migration file containing the `ALTER TABLE … ADD COLUMN IF NOT EXISTS` block and a `CREATE OR REPLACE FUNCTION public.aggregate_device_events()` matching the SQL in the user's message. After approval, read `control.functions.ts` to confirm the bucket query already returns the new columns; patch only if needed.
