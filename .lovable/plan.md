
## Ziel
Node-RED auf dem Pi bleibt die Eco-/MQTT-Engine. pi-hub wird der **Beobachtungs- und Steuerungs-Layer** — lokal (Dashboard) und global (Cloud), inkl. AI Deep-Path. Keine Logikduplikation: pi-hub liest `device_events`, schreibt **Control-Intents**, die Node-RED konsumiert.

## Architektur

```text
Node-RED (Eco-Engine, MQTT, Hardware-Guard)
   │
   ├── POST /api/public/ingest/event  (lokal, RAM-Ring, kein SD-Write)
   │        │
   │        └── Forward → Supabase device_events  (cloud-bridge)
   │
   ├── POST direkt → cloud /api/public/cloud-bridge/event  (Fallback bei lokalem Ausfall)
   │
   └── GET  /api/public/control/intents  (alle 10s pollen)
            ↑
   pi-hub Cloud UI / Telegram / MCP / Alexa schreibt Intents:
      - pump_override {minutes}
      - eco_pause / eco_resume
      - strategy_patch {pv_min_w, tibber_max_ct, heat_window, ...}
```

## Datenmodell (Supabase, neu)

1. `device_events` — falls noch nicht im pi-oasis-Format: Spalten `device_id, component, device, status, message, strategy_applied, metrics jsonb, ts`. Index auf `(device_id, ts desc)` und `(component, status, ts desc)`.
2. `device_events_hourly` — Aggregat (avg/min/max/p95 von `metrics->>'watts'`, count by status). Befüllt via `pg_cron` nachts.
3. `control_intents` — `id, device_id, kind, payload jsonb, created_by, created_at, consumed_at, result jsonb`. Node-RED holt offene Intents, quittiert mit `consumed_at`.
4. `strategy_profiles` — `device_id, params jsonb (pv_min_w, tibber_max_ct, heat_start, heat_end, run_minutes, max_minutes_per_day), updated_at`. Single-row pro Pi, von Node-RED beim Boot + alle 10 min gepollt.
5. `anomaly_baselines` — `device_id, metric, mean, stddev, window_days, updated_at`. Cron-Job berechnet täglich aus `device_events`. Trigger Telegram-Nachricht wenn `|x − mean| > 3·stddev`.

Alle Tabellen mit RLS via `devices.user_id` + GRANTs für `authenticated` und `service_role`.

## Backend (TanStack server routes / fns)

- `POST /api/public/cloud-bridge/event` — Device-Token Auth, Zod-Validierung, Insert in `device_events`. (Direkter Pfad von Node-RED.)
- `GET /api/public/control/intents` — Device-Token, gibt unverbrauchte Intents.
- `POST /api/public/control/intents/:id/ack` — markiert `consumed_at` + speichert `result`.
- `POST /api/public/control/intents` (authenticated server fn) — UI/MCP/Telegram legt Intents an. RLS prüft Ownership.
- `GET /api/public/strategy/:deviceId` — Node-RED holt aktuelle Params.
- Cron-Hook `/api/public/hooks/aggregate-events` (täglich 03:00) — schreibt `device_events_hourly`, prunet healthy-Events >7d.
- Cron-Hook `/api/public/hooks/anomaly-scan` (stündlich) — aktualisiert `anomaly_baselines`, sendet Telegram bei Drift.

## Pi-Seite

- `src/lib/ingest-buffer.server.ts` (existiert) erweitern: **dual write** — RAM-Ring + best-effort POST an Cloud `/cloud-bridge/event`. Bei 5xx oder Offline: nur Ring, später re-flushen über cloud-bridge.
- `cloud-bridge.server.ts`: zusätzlich `control_intents` pollen und an **Node-RED HTTP-In** (`http://127.0.0.1:1880/control`) weiterreichen. Node-RED kriegt damit die Intents native.
- Neuer Endpoint `GET /api/public/strategy` (loopback, kein Auth nötig — nur 127.0.0.1) für Node-RED.

## Node-RED (User-seitige Mini-Anpassung, dokumentiert in `docs/nodered.md`)

- HTTP-In Node `/control` → Switch auf `kind` → MQTT publish bzw. `global.set("zisterne_eco_allow_override", …)`.
- HTTP-Request Node alle 5 min → `http://127.0.0.1:8080/api/public/strategy` → schreibt Werte in `flow.set("strategy", …)`. Die existierenden Filterregeln lesen daraus statt aus Hard-Codes.
- Optional zweiter HTTP-Request Node parallel zum Ingest, der direkt auf `https://pi-hub.benniwie.com/api/public/cloud-bridge/event` schickt (für Robustheit bei lokalem pi-hub-Restart).

## UI

### Lokal (`/_authenticated/events.tsx` ausbauen)
- Live-Feed bleibt, plus Filter `component`/`status`/`strategy_applied`.
- Pump-Override-Button (Slider 1–60 min) → schreibt Intent in lokalen Store (cloud-bridge spiegelt sofort an Node-RED).
- Eco-Pause-Toggle, Strategy-Form (pv_min_w / tibber_max_ct / heat_window / run_minutes).

### Cloud (`/_cloud/devices.$id`)
- Tab **Timeline**: virtualisiertes List über `device_events` (paginated, Filter wie oben).
- Tab **Charts**: Watt-Linie (Recharts) aus `metrics->>'watts'`, kWh/Tag, Decision-Heatmap (`strategy_applied` × Stunde).
- Tab **Strategy**: Form schreibt nach `strategy_profiles`. Live-Preview „nächste Entscheidung".
- Tab **Anomalies**: 490 W Baseline, Drift-Chart, letzte Alerts.

### Telegram / MCP (Deep-Path)
- Neuer MCP-Tool `query_events(device_id, since, filter)` + `explain_last_decision(device_id)`.
- Telegram-Free-Text → Gemini (`google/gemini-3-flash-preview`) mit System-Prompt + Tool-Calls → menschliche Antwort.
- Bestehender Fast-Path (`/pump`, `/eco_off`) ruft direkt `control_intents`-fn.

## Sicherheit
- Direct-Cloud-Ingest authentifiziert via existierendes `device_token` (HMAC-hash gespeichert).
- `control_intents` RLS: nur Owner darf inserten; Pi konsumiert via Device-Token.
- Strategy-Patches via `strategy_profiles` mit Audit (`mcp_audit` mitschreiben).
- Loopback-Endpoints auf dem Pi prüfen `request.socket.remoteAddress === '127.0.0.1'`.

## Build-/Pi-Slim-Disziplin
- UI-Code für Charts/Anomaly nur in Cloud-Bundle (Slim-Mode auf Pi lädt Recharts nicht).
- Keine neuen ARM-kritischen Deps; Aggregation läuft serverlos in Supabase.

## Reihenfolge der Implementierung
1. Migration: 5 Tabellen + RLS + GRANTs + Indizes.
2. Server-Routes `cloud-bridge/event`, `control/intents`, `strategy/:deviceId`, `hooks/aggregate-events`, `hooks/anomaly-scan`.
3. Pi-seitig: ingest-buffer dual-write, cloud-bridge konsumiert Intents → loopback POST nach Node-RED.
4. Cron via pg_cron (insert-tool) für Aggregation + Anomaly.
5. UI Cloud Devices: Timeline / Charts / Strategy / Anomalies.
6. UI lokal: Override + Eco-Pause + Strategy-Form.
7. MCP-Tools + Telegram Deep-Path.
8. `docs/nodered.md` mit fertigen Flow-Snippets (Copy-Paste JSON für HTTP-In `/control` + HTTP-Request `/strategy` + direct cloud forward).

## Out of scope (bewusst)
- Migration der Eco-Engine in pi-hub-Plugins (du hast „Node-RED bleibt" gewählt).
- Ablösung des existierenden `smart_pump`-Plugins — wir lassen es für simulierte/andere Pumps stehen.
