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

## 3. Cloud commands → Node-RED → MQTT pump (WebSocket first)

Cloud, Alexa, Telegram and MCP pump actions are **pushed** over a Supabase
Realtime WebSocket. HTTP polling is only a 15-minute safety net — this is what
keeps the database asleep and the running cost near zero.

### 3.1 Bootstrap (once per deploy)

```http
GET https://pi-hub.benniwie.com/api/public/agent/realtime
Authorization: Bearer <CLOUD_DEVICE_TOKEN>
```

```json
{
  "supabaseUrl": "https://<project-ref>.supabase.co",
  "supabaseKey": "<publishable/anon key — never the service role>",
  "deviceId": "8f0c…",
  "channel": "commands:8f0c…",
  "safetyNetPollMs": 900000
}
```

Build the socket URL from the response:

```text
CLOUD_WS_URL = wss://<project-ref>.supabase.co/realtime/v1/websocket?apikey=<supabaseKey>&vsn=1.0.0
CLOUD_DEVICE_ID = <deviceId>
```

The template's `Store Realtime Info` node prints both values via `node.warn`
so you can paste them into the tab env. They are stable — the device id only
changes if you re-pair.

### 3.2 Joining the channel

Node-RED uses one `websocket in` + `websocket out` pair on the same
`websocket-client` config (`path = ${CLOUD_WS_URL}`, payload mode "String").

Send the Phoenix join frame after connect, then a heartbeat every 30 s
(otherwise Realtime closes the socket after 60 s):

```json
{ "topic": "realtime:commands:<deviceId>", "event": "phx_join",
  "payload": { "config": { "broadcast": { "self": false } } }, "ref": "1" }
```

```json
{ "topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": "2" }
```

### 3.3 Incoming command

```json
{
  "topic": "realtime:commands:<deviceId>",
  "event": "broadcast",
  "payload": {
    "type": "broadcast",
    "event": "wake",
    "payload": {
      "ts": "2026-07-30T18:12:00Z",
      "command": {
        "id": "…",
        "kind": "plugin_manual",
        "payload": { "id": "pump", "runner": "nodered", "action": "on", "minutes": 10 }
      }
    }
  }
}
```

The full command travels inside the broadcast, so **no follow-up HTTP call is
needed**. If `command` is `null` (oversized payload), fall back to:

```http
GET https://pi-hub.benniwie.com/api/public/agent/poll?runner=nodered
Authorization: Bearer <CLOUD_DEVICE_TOKEN>
```

The template maps the command to MQTT topic `cmnd/zisterne/POWER` with payload
`ON`/`OFF` (auto-OFF via trigger node), then acknowledges it:

```http
POST https://pi-hub.benniwie.com/api/public/agent/result
Authorization: Bearer <CLOUD_DEVICE_TOKEN>
Content-Type: application/json

{ "id": "<command-id>", "ok": true, "result": { "handled_by": "nodered" } }
```

The normal Pi agent ignores `runner=nodered` commands, so commands are not
executed twice.

### 3.4 WebSocket failure modes

| Symptom | Cause |
| ------- | ----- |
| Socket connects, no messages | `phx_join` never sent, or wrong `realtime:` topic prefix |
| Socket drops every ~60 s | heartbeat missing |
| `401`/immediate close | wrong or missing `apikey` query param |
| Bootstrap returns `unknown device` | `CLOUD_DEVICE_TOKEN` is not the pairing token |
| Commands only arrive every 15 min | socket is down, safety-net poll is doing the work |


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

## 7. Systemwerte (CPU/RAM/Disk/Temp) — ab v3

Systemtelemetrie gehört **nicht** mehr nach `device_events` (das erzeugte früher
~600 Zeilen/Tag als `system_hardware`). Sie geht über denselben Live-Relay:

`POST /api/public/live/publish`

```json
{ "cpu_pct": 14.2, "mem_pct": 61.0, "disk_pct": 17,
  "swap_pct": 0, "temp_c": 48.3, "uptime_s": 918273 }
```

Was der Server damit macht:
1. **Broadcast** auf `live:<device_id>` → offene Dashboards zeigen es sofort, 0 DB-Kosten.
2. **Spiegel** nach `device_state_latest` — gedrosselt auf **max. 1 Write / 5 Min**
   (`LIVE_SYS_MIRROR_MS`). Damit sind die Gauges auch dann gefüllt, wenn stunden-
   lang kein Browser offen war. Kosten: ~288 winzige Upserts/Tag.

Die mitgelieferte Flow-Vorlage enthält dafür den Zweig
**„System Stats (60s)" → „Read CPU/RAM/Disk/Temp" (exec) → „Build Live Telemetry
Request" → „POST Live Telemetry"**. Empfohlenes Intervall: 60 s.

### Checkliste: „Warum kommen keine Systemwerte an?"

1. `/connections/usage` → Tabelle **„Eingang pro Komponente"**. Steht dort
   `system (live-relay): nie` oder ein Alter von Stunden, sendet Node-RED nicht.
2. Geräteseite → Snapshot-Kopfzeile zeigt `live`, `vor X Min` oder
   `keine Systemdaten`. Alles > 30 Min wird rot.
3. Node-RED: exec-Node manuell auslösen — liefert er JSON? Auf Nicht-Pi-Systemen
   fehlt `/sys/class/thermal/thermal_zone0/temp`, dann bleibt `temp_c` leer, der
   Rest funktioniert trotzdem.
4. `CLOUD_DEVICE_TOKEN` und `CLOUD_LIVE_URL` in den Tab-Env-Werten gesetzt?
   (Werte stehen in Pi-Hub unter `/integrations`.)
5. HTTP 401 = falscher/abgelaufener Token, 403/404 = falsche URL.

## 8. Kosten-Regeln (was in die DB darf)

| Datenart | Route | DB-Writes |
| --- | --- | --- |
| Watt/PV/Temp-Ticks | `/live/publish` | 0 |
| Systemwerte | `/live/publish` | 1 / 5 Min |
| Zustandswechsel, Warnung, Kritisch | `/cloud-bridge/event` | 1 pro Ereignis |
| Abgeschlossener Pumplauf | `/cloud-bridge/event` (`pump_session`) | 1 |
| Heartbeat der Pi-Bridge | `/agent/heartbeat` | 1 / 15 Min |

`/cloud-bridge/event` verarbeitet einen ganzen Batch inzwischen in **einem
einzigen** Postgres-Aufruf (`ingest_device_events`) inklusive Dedup, Spiegel und
Session-Write-Back — vorher waren es 2–3 Roundtrips pro Ereignis.


## 9. Trace-/Debug-Mode (Request-IDs)

Jeder ausgehende Request des Templates trägt jetzt den Header `x-request-id`
(z. B. `evt-m8fq2k-a13c`). Die Cloud spiegelt ihn in **jeder** Antwort — auch bei
401/400/500 — als Feld `rid` und als Response-Header zurück. Damit lässt sich
exakt zuordnen, was gesendet und was verworfen wurde.

### Schalter

Tab-Env `TRACE_MODE`:

| Wert | Wirkung |
| --- | --- |
| `off` | keine Debug-Ausgabe (Ringpuffer wird trotzdem gefüllt) |
| `errors` (Default) | nur fehlgeschlagene Requests als Einzeiler |
| `full` | jeder Request mit gesendetem Body und roher Antwort |

Der Node **Trace Log (rid)** sammelt alle Antworten (inkl. Catch-Node der
Cloud-Pushes) und hält die letzten 50 Einträge im Flow-Context
(`flow.pihub_trace`). Der Inject-Node **Trace Report (letzte 50)** gibt sie
gesammelt aus — auch wenn das Debug-Panel vorher zu war.

Beispielzeile:

```text
evt-m8fq2k-a13c -> POST /cloud-bridge/event | 2 item(s) | 200 | received=2, inserted=1, deduped=1, dropped=0 (312 ms)
```

### Antwortfelder pro Route

| Route | Felder | Bedeutung |
| --- | --- | --- |
| `/cloud-bridge/event` | `received`, `inserted`, `deduped`, `dropped` | `deduped` = identisches Ereignis war schon da, `dropped` = von der Ingest-Funktion verworfen |
| `/live/publish` | `throttled`, `retry_in_ms`, `broadcast`, `received`, `used`, `dropped`, `system_fields`, `system_mirrored`, `mirror_skipped` | `throttled` = zu schnell gesendet (Standard 2 s/Gerät), `dropped` = ältere Ticks im Array, `mirror_skipped` = `no_system_fields` / `mirror_throttled` / `mirror_failed` |
| `/agent/result` | `command_id`, `status` | Command als `done`/`failed` verbucht |
| `/cloud-bridge/strategy` | `params`, `eco_paused`, `updated_at` | aktuelle Cloud-Strategie |

### Symptom → was im Trace steht

| Symptom | Trace-Zeile |
| --- | --- |
| Token falsch/leer | `401 | error=unknown device` bzw. `error=no token` |
| Systemwerte kommen nicht an | `sys-… | 200 | mirror_skipped=mirror_throttled` (normal, max. 1 Write/5 Min) oder `system_fields=0` (Node-RED sendet keine Felder) |
| Live-Ticks „verschwinden" | `throttled=true, retry_in_ms=…` — Sendetakt drosseln |
| Doppelte Events | `deduped=…` > 0 |
| Cloud nicht erreichbar | `no-response | transport=…` (Catch-Node) |
| `RID-MISMATCH` | Ein Proxy/HTTP-Node überschreibt Header — im HTTP-Node dürfen keine festen Header/Auth gesetzt sein |

## 10. Dual-Sink: Cloud + lokale App (48h lokale Historie)

Jeder Push geht jetzt optional **doppelt** raus: an die Cloud (wie bisher) und an die
lokal auf dem Pi laufende Pi-Hub App. Die lokale App speichert Ticks, Events und Traces
48 Stunden lang in JSONL-Dateien unter `~/.pi-hub/timeseries/` und zeigt sie unter
**/pumpe** (Live-Gauges, 48h-Charts, Debug-/Trace-Panel) an — komplett ohne Datenbank
und ohne Cloud-Wake.

### Neue Tab-Env-Werte

| Name | Default | Bedeutung |
| --- | --- | --- |
| `LOCAL_BASE_URL` | `http://127.0.0.1:8080` | Basis-URL der lokalen Pi-Hub App |
| `LOCAL_SINK` | `on` | `off` schaltet den lokalen Zweig komplett ab |
| `PI_INGEST_TOKEN` | leer | optional; ohne Token akzeptiert die App nur Aufrufe aus dem LAN/localhost |

### Lokale Endpunkte

| Endpunkt | Inhalt | Aufbewahrung |
| --- | --- | --- |
| `POST /api/public/ingest/live` | Live-Ticks (Watt, Systemwerte) | 48h, für die Persistenz heruntergesampelt |
| `POST /api/public/ingest/event` | Events / Session-Summaries | 48h |
| `POST /api/public/ingest/trace` | Trace-Zeilen inkl. Cloud-Antwort | 48h |

### Was der Flow zusätzlich macht

- `Build Local Sink Request` hängt an den drei Build-Nodes (Event, Live-Telemetrie,
  Command-Result) und schickt dieselbe Nutzlast an den passenden lokalen Endpunkt.
- `Mirror Trace → Local App` spiegelt **jede** Trace-Zeile lokal — unabhängig von
  `TRACE_MODE`. `TRACE_MODE` steuert nur noch, was im Node-RED-Debug-Panel landet.
- Ein `status`-Node am WebSocket meldet Verbindungs-/Trennereignisse ebenfalls als
  lokalen Trace, damit man Wake-Ausfälle im Nachhinein sehen kann.

So lässt sich jeder Fall lokal prüfen: Ist ein Event lokal da, aber in der Cloud nicht,
zeigt der Trace mit derselben `rid` genau Statuscode und Grund.
