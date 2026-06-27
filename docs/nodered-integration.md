# Node-RED ↔ Pi-Hub Cloud Integration

The Pi keeps its Node-RED brain, but mirrors decisions and metrics into the
cloud so dashboards, analytics and the LLM can see what's happening — without
writing anything to the SD card.

## 1. Direct event ingest

`POST https://pi-hub.benniwie.com/api/public/cloud-bridge/event`

Headers:

```
Authorization: Bearer <DEVICE_TOKEN>      # the token from /cloud/devices pairing
Content-Type:  application/json
```

Body (single event **or** array of up to 50):

```json
{
  "component": "eco_intelligence",
  "device": "drainpress",
  "status": "info",
  "message": "Pralle Sonne. Wasser verdunstet sofort.",
  "strategy_applied": "EVAPORATION_HEAT_BLOCK",
  "metrics": { "watts": 0, "temp_c": 31.4, "cloud_pct": 5, "tibber_ct": 18 },
  "ts": "2025-07-17T12:10:00Z"
}
```

`status` is free-form, but `healthy` events are pruned after 7 days by the
nightly aggregation job — only `info / warning / critical` stay forever.

### Node-RED HTTP-request node template

* URL: `https://pi-hub.benniwie.com/api/public/cloud-bridge/event`
* Method: `POST` · Return: `parsed JSON`
* Headers (set via change node before): `Authorization = Bearer {{flow.device_token}}`
* Payload: the JSON above (msg.payload)

Buffer locally in a `delay`-rate-limited path so a cloud outage doesn't drop
events: 50 events / 30 s is well below the API throttle.

## 2. Strategy polling (read)

Node-RED can pull cloud-managed thresholds every ~10 min so you change them
from your phone without SSHing into the Pi.

`GET /api/public/cloud-bridge/strategy` (same bearer token).

Response:

```json
{
  "params": {
    "pv_min_w": 300,
    "tibber_max_ct": 30,
    "heat_start_hour": 11,
    "heat_end_hour": 16,
    "run_minutes": 10,
    "max_minutes_per_day": 30,
    "rain_veto_mm": 0.1
  },
  "eco_paused": false,
  "updated_at": "2025-07-17T11:00:00Z"
}
```

Store on the flow context (`flow.set('strategy', msg.payload)`) and read it
inside the Eco-Guard function node. If `eco_paused === true`, short-circuit
the engine: `global.set("zisterne_eco_allow", false)`.

## 3. Maintenance cron jobs (cloud-side)

These run server-side, no Pi load. Wire them in Supabase `pg_cron` (or any
external scheduler) and POST with the project's anon key as `apikey` header:

| Endpoint                                | Suggested schedule | Purpose                                            |
| --------------------------------------- | ------------------ | -------------------------------------------------- |
| `/api/public/hooks/aggregate-events`    | `5 3 * * *`        | hourly buckets + prune `healthy` events > 7 d      |
| `/api/public/hooks/anomaly-scan`        | `15 * * * *`       | recompute watt μ/σ baseline per device             |

Both call `SECURITY DEFINER` SQL functions that are only `EXECUTE`-grantable to
`service_role`, so they're safe to expose publicly behind the apikey gate.

## 4. UI

`/cloud/devices/<id>` now has four tabs:

* **Timeline** — last 100 events, live (10 s refresh).
* **Verlauf** — sparkline of hourly average watts (7 d).
* **Strategie** — edit thresholds, pause/resume eco mode, send pump-overrides.
* **Anomalien** — μ/σ baselines from the anomaly job.

The Pi local dashboard stays minimal (slim mode); rich analytics live in the
cloud where CPU is free.
