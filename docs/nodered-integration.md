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

Import `/nodered-template.json` from the Pi UI. Important settings in every
HTTP request node:

* **Method:** `use msg.method`
* **URL:** empty
* **Authentication:** disabled / empty
* **Headers:** empty

The function nodes set `msg.method`, `msg.url` and `msg.headers`. If the HTTP
node has a fixed URL or built-in Bearer auth, Node-RED 3/4 prints
`msg properties can no longer override set node properties` and silently sends
the wrong token/URL. This was the reason for the observed 401.

Buffer locally in a `delay`-rate-limited path so a cloud outage doesn't overload
the Pi: 50 events / 30 s is well below the API throttle.

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

## 3. Cloud commands → Node-RED → MQTT pump

Cloud, Alexa, Telegram and MCP pump actions are queued in the cloud and polled by
Node-RED:

```http
GET https://pi-hub.benniwie.com/api/public/agent/poll?runner=nodered
Authorization: Bearer <CLOUD_DEVICE_TOKEN>
```

Example response:

```json
{
  "command": {
    "id": "...",
    "kind": "plugin_manual",
    "payload": { "id": "pump", "runner": "nodered", "action": "on", "minutes": 10 }
  }
}
```

The template maps this to MQTT topic `cmnd/zisterne/POWER` with payload `ON` or
`OFF`, then acknowledges the command:

```http
POST https://pi-hub.benniwie.com/api/public/agent/result
Authorization: Bearer <CLOUD_DEVICE_TOKEN>
Content-Type: application/json

{ "id": "<command-id>", "ok": true, "result": { "handled_by": "nodered" } }
```

The normal Pi agent ignores `runner=nodered` commands, so commands are not
executed twice.

## 4. Store weather, Tibber and pump usage

Send these standard components to the same event endpoint. They are stored in
`device_events` in the cloud and rolled up into `device_events_hourly` for
charts/AI. Local fallback stores only in RAM.

| Component          | Important metrics                                       | Purpose                         |
| ------------------ | ------------------------------------------------------- | ------------------------------- |
| `weather_dwd`      | `temp_c`, `cloud_pct`, `humidity_percent`, `rain_mm`    | watering veto / evaporation     |
| `tibber_price`     | `tibber_ct`                                             | price-aware automation          |
| `tibber_pulse`     | `house_power`, `power_production`, `watts`              | PV surplus, laundry reasoning   |
| `pump_guard`       | `watt`, `voltage`, `today_kwh`                          | dry-run / overload detection    |
| `pump_control`     | `runtime_min`, `source`, `command`                      | audit of manual/eco starts      |
| `eco_intelligence` | `pumping_allowed`, `pv_surplus_watt`, `strategy_applied` | explain decisions               |

Example Tibber Pulse event:

```json
{
  "component": "tibber_pulse",
  "device": "house",
  "status": "healthy",
  "message": "Live consumption update",
  "metrics": { "house_power": -420, "power_production": 780, "watts": -420 },
  "ts": "2026-06-29T06:10:00Z"
}
```

## 5. Maintenance cron jobs (cloud-side)

These run server-side, no Pi load. Wire them in Supabase `pg_cron` (or any
external scheduler) and POST with the project's anon key as `apikey` header:

| Endpoint                                | Suggested schedule | Purpose                                            |
| --------------------------------------- | ------------------ | -------------------------------------------------- |
| `/api/public/hooks/aggregate-events`    | `5 3 * * *`        | hourly buckets + prune `healthy` events > 7 d      |
| `/api/public/hooks/anomaly-scan`        | `15 * * * *`       | recompute watt μ/σ baseline per device             |

Both call `SECURITY DEFINER` SQL functions that are only `EXECUTE`-grantable to
`service_role`, so they're safe to expose publicly behind the apikey gate.

## 6. UI

`/cloud/devices/<id>` now has four tabs:

* **Timeline** — last 100 events, live (10 s refresh).
* **Verlauf** — sparkline of hourly average watts (7 d).
* **Strategie** — edit thresholds, pause/resume eco mode, send pump-overrides.
* **Anomalien** — μ/σ baselines from the anomaly job.

The Pi local dashboard stays minimal (slim mode); rich analytics live in the
cloud where CPU is free.

## 7. Token-Layout, local auth & Failure-Modes

| Symbol             | Wofür                          | Wo eintragen                              |
| ------------------ | ------------------------------ | ----------------------------------------- |
| CLOUD_DEVICE_TOKEN | Bearer zum Cloud-Push, Strategie und Commands | Node-RED Tab-env                         |
| PI_INGEST_TOKEN    | (optional) lokaler RAM-Fallback              | Tab-env, leer lassen wenn LAN-only       |

Die Werte siehst du zentral im Pi-UI unter **Node-RED** (`/integrations`) — dort kannst du sie 1-Klick kopieren und das fertige Subflow-Template (`/nodered-template.json`) runterladen.

**Cloud auth:** `CLOUD_DEVICE_TOKEN` is the token minted during Cloud pairing.
Do not use a reset/factory/revocation token. A 401 with
`{"error":"unknown device"}` means the bearer token does not match any paired
device or Node-RED sent an empty `Authorization: Bearer ` header.

**Local auth:** `/api/public/ingest/event` is Pi-local and SD-card safe. If
`PI_INGEST_TOKEN` is set, it requires `Authorization: Bearer <PI_INGEST_TOKEN>`.
If it is empty, it accepts only localhost/private-LAN requests and keeps events
in an in-memory ring buffer.

```
Tibber Pulse ──┐
DWD Wetter ────┼──► Eco-Engine ──► (Cloud-Push subflow) ──► pi-hub.benniwie.com
PV Sensoren ───┘                                  │
                                                  └─► (Local fallback) ─► http://<lan-ip>:3000
```

**Failure-Modes**:

* Cloud 401 → wrong/empty `CLOUD_DEVICE_TOKEN` or HTTP node built-in auth overriding headers.
* Cloud nicht erreichbar → `catch`-Node leitet Payload auf `Local Fallback Push`.
* Tibber-API down → letzten bekannten Preis nutzen (`flow.set('tibber_last', ...)`).
* DWD-API down → konservativer Modus (kein Gießen ohne Wetterdaten).

## 8. Reasoning-Tools für die KI

Cloud-MCP-Server exponiert die folgenden Tools, die direkt auf den von Node-RED gepushten Events arbeiten — kein Pi-Roundtrip:

| Tool                     | Frage                                              |
| ------------------------ | -------------------------------------------------- |
| `get_power_history`      | "Wieviel Strom haben wir die letzte Stunde gezogen?" |
| `get_tibber_price_now`   | "Wie teuer ist Strom gerade?"                      |
| `infer_appliance_state`  | "Ist meine Wäsche fertig?"                         |

Schwellwerte pro Gerät in `appliance_profiles` (z.B. Waschmaschine: ≥150 W läuft, &lt;5 W = Leerlauf).

## 6. Zero-Wake Architektur (ab v2)

Die Datenbank ist teuer, **weil sie 24/7 wach ist**. Deswegen laufen Live-Ticks
jetzt komplett an Postgres vorbei über Supabase Realtime Broadcast.

**Route A — Live-Ticks (jede Sekunde, KEIN DB-Insert):**

`POST https://pi-hub.benniwie.com/api/public/live/publish`

Header: `Authorization: Bearer <DEVICE_TOKEN>`

Body:
```json
{ "watts": 512, "pv_surplus_w": 340, "outside_temp_c": 22.1,
  "pump_on": true, "strategy_applied": "SOLAR_PEAK", "ts": "…" }
```

Der Server broadcastet die Nachricht auf Kanal `live:<device_id>`. Der
Browser abonniert direkt via WebSocket — die DB bleibt schlafen.

**Route B — Sessions/Alarme (selten, DB-Insert):**

Bleibt `POST /api/public/cloud-bridge/event`. Neu: hänge in `metrics`
folgende Felder für abgeschlossene Pumpläufe an:

```json
"metrics": {
  "pump_session": true,
  "started_at": "…", "stopped_at": "…",
  "avg_watts": 510, "kwh": 0.085,
  "pv_covered_pct": 82.5,
  "trigger": "eco", "reason": "Solar-Peak 10min"
}
```

Damit landet der Lauf in `pump_sessions` (Analytics-Basis, ersetzt das
Aggregieren aus Rohdaten). Zusätzlich pflegt jeder Event `device_state_latest`
automatisch — dashboard-Cold-Start liest von dort in einer einzigen Query.

**Empfehlung für Node-RED:**
- Live-Push: 1× pro Sekunde → `CLOUD_LIVE_URL`
- Alarm/Status-Wechsel: sofort → `CLOUD_BRIDGE_URL`
- Session-Ende (Pumpe geht aus): 1× → `CLOUD_BRIDGE_URL` mit `pump_session=true`
- Heartbeat: nicht mehr nötig, Pi-Bridge macht das alle 15 min selbst
