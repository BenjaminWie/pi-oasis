# Zero-Wake Architektur: Pi als Session-Aggregator, Cloud als Stateless-Relay

Ziel: Cloud-Postgres bleibt die meiste Zeit schlafend (`Cloud compute pico` von ~2.4 → ~0.3–0.5 credits/Tag), UI bleibt live, keine SD-Karten-Belastung.

## Kernentscheidung

Die DB ist teuer, **weil sie 24/7 wach ist**, nicht weil sie viel schreibt. Also splitten wir den Datenfluss in zwei Bahnen:

```text
                            ┌──────────────────────────────────────────┐
                            │ Route A: Live-Ticks (jede Sekunde)       │
Node-RED (RAM)  ────────►   │  → Supabase Realtime Broadcast Channel   │
                            │  → KEIN DB-Insert. DB schläft weiter.    │
                            └────────────┬─────────────────────────────┘
                                         │
                            Browser abonniert WebSocket direkt
                                         │
                            ┌────────────▼─────────────────────────────┐
Node-RED bei Pump-STOP ───► │ Route B: Sessions/Alarms (selten)        │
Node-RED bei Alarm ───────► │  → /api/public/cloud-bridge/event(-batch)│
                            │  → INSERT in device_events (~20/Tag)     │
                            │  → UPSERT in device_state_latest         │
                            └──────────────────────────────────────────┘
```

## Umsetzung (in dieser Reihenfolge)

### Migration 1 — DB-Umbau

- **Neue Tabelle `device_state_latest`** (1 Zeile pro Gerät): `device_id PK`, `pump_on bool`, `pump_started_at`, `watts_current`, `pv_surplus_w`, `outside_temp_c`, `strategy_applied`, `updated_at`. Getter für Cold-Start des Dashboards.
- **Neue Tabelle `pump_sessions`**: `id`, `device_id`, `started_at`, `stopped_at`, `duration_s`, `avg_watts`, `kwh`, `pv_covered_pct`, `trigger` (`manual|schedule|eco`), `reason`. Ersetzt raw device_events als Analysebasis für Pump-Nutzung.
- **RLS + GRANTs** auf beide Tabellen (owner-scoped).
- **pg_cron kill**: `unschedule` für `aggregate_device_events` (15 min). Behalten: nur ein Job **1×/Nacht** für Daily-Rollup + Retention. Anomaly-Scan auf 1×/Tag.
- **Realtime aktivieren** für `device_state_latest` (Fallback wenn Broadcast-Channel nicht erreichbar).

### Route A — Stateless Live-Relay

- **Neuer Server-Route** `src/routes/api/public/live/publish.ts`: POST-Endpoint für Node-RED. Nimmt `{device_id, watts, pv_surplus_w, outside_temp_c, pump_on, ts}` an, auth über `device_token_hash`.
- Handler verifiziert Token, dann **sendet direkt an Supabase Realtime Broadcast Channel** `live:{device_id}` via publishable-key client. **Kein DB-Insert.** (Broadcast-Nachrichten laufen nicht durch Postgres → kein DB-Wakeup, keine Compute-Zeit.)
- Rate-Limit: max 2 msg/s pro Device (in-memory Map im Worker).

### Route B — Session/Alarm-Ingest (existing endpoint, gehärtet)

- `src/routes/api/public/cloud-bridge/event.ts` bekommt neuen Body-Typ `session_summary`:
  - `{kind: "pump_session", started_at, stopped_at, duration_s, avg_watts, kwh, pv_covered_pct, trigger}`
  - → INSERT in `pump_sessions` + UPSERT in `device_state_latest` (pump_on=false)
- Neuer Body-Typ `state_change`: pump_on=true beim Start → UPSERT `device_state_latest`.
- Alarme (`warning`/`critical`) bleiben wie bisher, aber landen zusätzlich in `device_state_latest` (`last_alarm`).
- Bestehende Heartbeat/Dedup-Logik im Endpoint **entfernen** (Node-RED puffert jetzt selbst).

### Pi-Bridge (`src/lib/cloud-bridge.server.ts`)

- Heartbeat: **30 s → 15 min** (bleibt nur für "Pi lebt"-Anzeige).
- Live-Metrik-Emission: entfällt komplett (macht Node-RED direkt).
- Command-Poll bleibt Long-Poll (kostet nix).

### Node-RED-Template neu (`public/nodered-template.json`)

Neuer Tab **"Session Aggregator"** ersetzt die aktuellen Live-Push-Nodes:

```text
[MQTT tele/pump/SENSOR]──┐
[MQTT stat/pump/POWER]───┼──►[fn: session-tracker (RAM)]──┬──►[fn: emit live tick every 1s]──►[HTTP POST /live/publish]
[Tibber Pulse WS]────────┤    keeps flow.session = {          │
[DWD API 15min]──────────┘    started_at, samples[], pv,     │
                              rain_win24h[], commit_until}    │
                                                              └──►[on pump OFF: emit session_summary]──►[HTTP POST /event]
                                                              └──►[on alarm: emit alarm]──────────────►[HTTP POST /event]
```

Die `session-tracker` function node hält alles in `flow.` context (RAM), inkl.:
- **Virtual PV**: `pv_display = pv_raw + (pump_on ? pump_watts : 0)`.
- **Run-Commitment**: wenn `now < commit_until`, ignoriere Eco-Abschaltbedingungen.
- **Sliding-Window Weather**: `rain_win24h` als Ring-Buffer der letzten 24 h.

Dokumentation in `docs/nodered-integration.md` mit vollem Fluss + Copy-Paste-Function-Code.

### Frontend-Umbau

- **`src/routes/_cloud/pump.tsx`**: Live-Daten-Query auf `device_state_latest` (1× beim Mount, `staleTime: Infinity`) + Supabase Realtime Broadcast Subscription auf `live:{device_id}`.
- Alle bisherigen Polling-Intervalle (`refetchInterval: 30000` etc.) auf **`false`** — reine WebSocket-basierte Live-Updates.
- Historie (letzte 6 h Chart): liest aus `pump_sessions` + `device_events_hourly`, refetch nur manuell / bei Sitzungs-Wechsel (`staleTime: Infinity`).
- `PumpInsights` 30-Tage: liest `device_events_daily`, 1× pro Sitzung.
- **`src/hooks/use-dynamic-favicon.ts`**: liest `device_state_latest.pump_on`, subscribed auf Broadcast — kein 15s-Poll auf `device_events` mehr.

### Migration 2 — Cleanup / Retention

- `device_events`: Retention Rohdaten von 48 h → **12 h** (nur noch Alarme + Session-Summaries landen dort).
- `device_events_hourly`: 90 → 60 Tage.
- Aggregations-Funktion umschreiben: liest jetzt aus `pump_sessions` (nicht mehr raw events).

## Erwarteter Effekt

| Aktion | Vorher | Nachher |
|---|---|---|
| DB-Writes/Tag | ~2000 events + 2880 heartbeats + pg_cron | ~20 session rows + 96 state upserts |
| pg_cron Wakeups | 96 + 24 + Anomaly-Scan | 1 (nachts) |
| UI-DB-Reads pro Sitzung | ~10 aktive Queries | 2 (cold-start) |
| Live-Latenz | 30 s (Poll) | <1 s (WebSocket) |

`Cloud compute pico` sollte auf **0.3–0.5 credits/Tag** fallen. Live-Latenz wird sogar **besser**, weil WebSocket statt 30s-Poll.

## Warum das die Realtime-Kosten nicht in die Höhe treibt

Supabase Realtime **Broadcast** (nicht Postgres-Changes!) läuft komplett am DB-Server vorbei — Nachrichten werden im Worker-Netz verteilt. Kosten sind Bandbreite (bei ~50 Bytes/s pro User vernachlässigbar) statt Compute-Stunden.

## Nicht im Scope

- SD-Karten-Persistenz auf dem Pi (weiterhin RAM-only wie gewünscht).
- Node-RED-Node-Struktur bleibt kompatibel, User kann Template runterladen und importieren.
- MCP / Telegram / Alexa / Command-Poll: unverändert, laufen über bestehende Endpoints.

## Rollback

Route A ist additiv. Falls Broadcast-Channel Probleme macht, fällt UI automatisch auf `device_state_latest`-Poll (30 s) zurück, weil Realtime auf dieser Tabelle aktiviert bleibt.
