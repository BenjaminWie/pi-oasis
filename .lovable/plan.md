## Goal

Let Node-RED on the Pi push structured pump/component events (the JSON shape you posted) into pi-hub, have pi-hub forward them straight to the cloud (Lovable Cloud / Supabase) for storage + UI, and keep **nothing on the SD card** — only RAM buffers with a hard cap.

## Architecture

```text
Node-RED (Pi)
   │ HTTP POST  http://127.0.0.1:<piPort>/api/public/ingest/event
   │ Header:    Authorization: Bearer <INGEST_TOKEN>   (loopback only)
   ▼
pi-hub local server (TanStack server route)
   │ - verify token (hashed, compared timing-safe)
   │ - validate JSON with zod
   │ - push into in-memory ring buffer (max 200, no fs writes)
   │ - fan out: (a) cloud forwarder  (b) plugin decision log  (c) SSE to UI
   ▼
Cloud forwarder (existing cloud-bridge channel)
   │ HTTPS to Lovable Cloud relay (already authenticated as device)
   ▼
Supabase: new table `device_events` (RLS by user_id via device_id join)
```

No `fs.writeFile`, no SQLite, no Influx writes from this path. The Pi-local store (`~/.pi-hub/plugins.json`) is **not** touched by ingest.

## Security model

- **Loopback-only ingress**: the new route only accepts requests whose remote address is `127.0.0.1` / `::1`. Node-RED runs on the same Pi, so this is enforceable and means the token never crosses the LAN.
- **Bearer token**: generated once via `generate_secret` and stored as `PI_INGEST_TOKEN` (runtime secret). Node-RED reads it from an env var injected by systemd — never hardcoded in a flow export.
- **Hashed compare**: server stores `sha256(token)` and compares with `timingSafeEqual`.
- **Schema validation**: strict zod schema for the payload you posted (`component`, `device`, `timestamp`, `status`, `metrics`). Unknown fields rejected.
- **Rate limit**: 20 req/s per device in memory; excess returns 429.
- **TLS to cloud**: forwarder uses the existing HTTPS cloud-bridge, which already authenticates as the paired device (device_token). No new outbound credential.
- **No PII**: events are device telemetry; the cloud row only stores `device_id`, `component`, `status`, `metrics` JSON, `occurred_at`.

## Zero-SD-write guarantees

- Ring buffer is a plain JS array capped at 200 entries, lives in the server process RAM.
- Cloud forwarder is fire-and-forget with retry-in-memory (max 50 queued); on overflow it drops oldest and increments a `dropped` counter shown in the UI.
- `tmpfs` recommendation in `scripts/install.sh`: mount `/var/log/pi-hub` as tmpfs so any accidental log line also stays in RAM. systemd unit gets `LogsDirectory=` removed and `StandardOutput=null` for the ingest path.
- Node-RED side: the imported flow has the file-write nodes removed and `Context Store` set to `memoryOnly` for any state the flow keeps.

## Files

**New**

- `src/routes/api/public/ingest/event.ts` — loopback-only POST handler (zod, token, ring buffer push, forward).
- `src/lib/ingest-buffer.server.ts` — in-memory ring buffer + SSE pub/sub + cloud forwarder queue.
- `src/routes/api/public/ingest/stream.ts` — SSE endpoint the UI subscribes to (auth via Supabase bearer, scoped to device).
- `src/routes/_authenticated/events.tsx` — live event feed UI with status pill, filter by component/device, "Forwarded to cloud ✓ / queued / dropped" indicator.
- `supabase/migrations/<ts>_device_events.sql` — `device_events` table + RLS + GRANTs (scoped via existing `devices.user_id`).
- `docs/node-red-ingest.md` — short doc: example HTTP Request node config, env var setup, systemd snippet.

**Edited**

- `src/lib/cloud-bridge.server.ts` — add `forwardEvent(payload)` that piggybacks on the existing relay channel (or POSTs to a new `/api/public/cloud-bridge/event` cloud route).
- `src/routes/api/public/cloud-bridge/claim.ts` (or sibling) — new `event.ts` cloud-side route that authenticates the device token and inserts into `device_events`.
- `scripts/install.sh` — mint `PI_INGEST_TOKEN` on first run, print Node-RED setup hint, optionally configure tmpfs for `/var/log/pi-hub`.
- `src/components/BottomNav.tsx` — add "Events" tab.

## DB

```sql
create table public.device_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.devices(id) on delete cascade,
  component text not null,
  device_label text not null,
  status text not null check (status in ('healthy','warning','critical','info')),
  metrics jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on public.device_events(device_id, occurred_at desc);

grant select on public.device_events to authenticated;
grant all on public.device_events to service_role;
alter table public.device_events enable row level security;

create policy "Users read events for own devices"
on public.device_events for select to authenticated
using (exists (
  select 1 from public.devices d
  where d.id = device_events.device_id and d.user_id = auth.uid()
));
```

Writes happen only via the cloud-side public route using `supabaseAdmin` after device-token verification — RLS stays clean.

## UI

`/events` route:

- Header with live SSE counter (events/min) and "Forwarded ✓ / Queued N / Dropped N".
- List grouped by component, each row: time, device, status pill (green/amber/red), key metrics inline (`395 W · 231 V · 0.45 kWh`).
- Click row → side sheet with full payload JSON and "raw" toggle.
- Filter chips by component and status.
- Empty state shows the exact `curl` Node-RED equivalent so the user can test from the Pi.

## Verification

1. `curl -H "Authorization: Bearer $PI_INGEST_TOKEN" -X POST http://127.0.0.1:<port>/api/public/ingest/event -d '<sample payload>'` from the Pi → 200, appears in `/events` instantly via SSE, row in `device_events` within ~1s.
2. Same curl from another LAN host → 403 (loopback gate).
3. Wrong token → 401, timing-safe.
4. `lsof -p <pi-hub pid> | grep plugins.json` after 100 events → no writes; `iostat` on the SD shows no extra writes attributable to pi-hub.
5. Kill the cloud relay for 30s, send 60 events → buffer holds them, reconnect drains, "Dropped 0".

## Out of scope (call out for follow-up)

- Auto-installing the Node-RED flow JSON (only doc + sample import for now).
- Long-term retention / charts in cloud (we just store rows; charting is a later plugin).
