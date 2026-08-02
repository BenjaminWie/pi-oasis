## Was ich in der Datenbank tatsächlich gefunden habe

Verifiziert per Query, nicht geraten:

- **Systemwerte kommen wirklich nicht mehr an.** Die letzten `system_hardware`- und `pump_monitor`-Events sind vom **30.07. 22:10 Uhr**. Seitdem nur noch `eco_intelligence` (zuletzt heute 18:01) und `pump_control` (heute 12:55). Der Node-RED-Flow, der CPU/RAM/Disk/Temp geschickt hat, sendet nicht mehr.
- **`devices.last_snapshot` ist NULL** — obwohl `last_seen_at` aktuell ist (heute 19:22). Die Gauges auf der Geräteseite lesen genau dieses Feld. Es wird nur vom Pi-Heartbeat (`/api/public/agent/heartbeat`) geschrieben; der läuft offenbar nicht bzw. der Pi-Bridge-Prozess pollt nur (das bumpt `last_seen_at` ohne Snapshot). Deshalb: Gerät „online", Kacheln leer.
- **Der nächtliche Cron-Job ist deaktiviert** (`cron.job` id 4, `active = false`). Aggregation (stündlich/täglich), Baselines und das Pruning von `device_events` laufen seit dem Deaktivieren nicht mehr → Analytics-Views bleiben stehen und alte Rohzeilen werden nie gelöscht.
- **DB-Größe ist unkritisch**: 16 MB gesamt, `device_events` 2,7 MB / 1386 Zeilen, Disk 17 %, Verbindungen 12/60, Memory 55 %. Die 1,4 Credits/Tag kommen also **nicht** aus Datenvolumen, sondern aus Laufzeit/Aktivität der Instanz.
- **145.154 zurückgerollte Transaktionen seit Boot** — auffällig hoch, deutet auf viele fehlschlagende Requests (RLS/Fehlerpfade), die die DB trotzdem wachhalten. Das wird noch nicht gemessen.

## Warum die 1,4 Credits noch da sind

Die Cloud-DB kostet primär pro *aktiver Zeit*, nicht pro Zeile. Alles, was sie regelmäßig aufweckt, hält die Kosten oben:

1. **Ingest-Endpunkt macht 2–3 DB-Roundtrips pro Event.** `/api/public/cloud-bridge/event` führt pro Event ein SELECT (letztes Event suchen) plus UPDATE oder INSERT aus, dazu Upserts in `device_state_latest`. Bei Batches multipliziert sich das linear.
2. **Offene Browser-Tabs pollen weiter.** Geräteseite alle 30 s (2 Queries), Analytics 120 s, Pump 300 s, lokale Overview 5 s. Ein den ganzen Tag offener Tab = tausende Server-Fn-Aufrufe.
3. **Kein Messpunkt für Fehl-Requests**, obwohl die Rollback-Zahl zeigt, dass es viele gibt.

## Plan

### 1. Ingest auf einen Roundtrip pro Batch bringen
- Dedup-Logik in eine einzige Postgres-Funktion (`ingest_device_events(jsonb)`) verlagern: Batch rein, Dedup/Insert/`device_state_latest`-Upsert/`pump_sessions` in **einer** Transaktion. Statt 3n Roundtrips → 1.
- Token→device-Auflösung im Worker cachen (wie bereits in `/live/publish` gelöst).

### 2. UI-Polling auf Event-getrieben umstellen
- Geräteseite und Analytics: `refetchInterval` entfernen, stattdessen auf den bestehenden Realtime-Broadcast (`live:<device_id>`) hören und nur bei tatsächlichem Tick invalidieren.
- Lokale Pi-Seiten (`overview` 5 s, `mqtt` 2 s) treffen die Cloud nicht, bleiben wie sie sind.
- Erwartung: bei geschlossenem Tab praktisch null DB-Aktivität.

### 3. Systemwerte wieder anschließen (das eigentliche „nicht verbunden"-Problem)
Zwei Wege, beide werden verdrahtet, damit es unabhängig vom Pi-Setup funktioniert:
- **Persistenter Pfad:** `/api/public/live/publish` nimmt bereits `cpu_pct`, `mem_pct`, `disk_pct`, `temp_c`, `uptime_s` an, verwirft sie aber nach dem Broadcast. Diese Felder zusätzlich (throttled, max 1×/5 min) in `device_state_latest` spiegeln — neue Spalten `cpu_pct`, `mem_pct`, `disk_pct`, `temp_c`, `uptime_s`, `sys_updated_at`. Kosten: ~288 kleine Upserts/Tag statt 620 Event-Zeilen wie früher.
- **UI:** Gauges auf `device_state_latest` umstellen mit Fallback auf `last_snapshot`, plus Live-Overlay aus dem Broadcast und sichtbarem „Stand: vor X Min"-Zeitstempel, damit stale Werte nie mehr wie aktuell aussehen.

### 4. Node-RED-Vorlage nachziehen
- `public/nodered-template.json`: den System-Telemetrie-Zweig auf `/api/public/live/publish` umhängen (alle 60 s, nur Broadcast/Spiegel — keine `device_events`-Zeilen mehr).
- `device_events` nur noch für echte Zustandswechsel und Warnungen/Kritisch.
- `docs/nodered-integration.md` entsprechend aktualisieren, inklusive Checkliste „warum kommen keine Systemwerte an".

### 5. Cron wieder aktivieren und Health sichtbar machen
- Job 4 reaktivieren (nächtlich, 1× pro Tag), damit Rollups laufen und Rohzeilen gepruned werden.
- Auf `/connections/usage` eine Zeile „Letzter Eingang pro Komponente" ergänzen (eine Query), damit ein abgerissener Node-RED-Zweig sofort auffällt statt nach Tagen.

## Realistische Erwartung zu den Credits

Punkt 1 + 2 senken die DB-Wachzeit deutlich; ein Rest bleibt, weil die Cloud-Instanz auch im Leerlauf abgerechnet wird. Von 1,4 auf ~0,5 ist plausibel, aber nicht garantiert — nach dem Umbau prüfe ich `db_health` und die Usage-Zahlen erneut und melde die echte Differenz. Falls dann die Instanzgröße der verbleibende Treiber ist, schlage ich ein Downsizing vor (Memory 55 %, Verbindungen 12/60 — Luft ist da).

## Technische Details

- Neue Migration: `ingest_device_events(jsonb)` (SECURITY DEFINER, `search_path=public`), Spalten auf `device_state_latest`, GRANTs für `service_role`, Cron-Job reaktivieren.
- Angefasste Dateien: `src/routes/api/public/cloud-bridge/event.ts`, `src/routes/api/public/live/publish.ts`, `src/routes/_cloud/devices.$id.tsx`, `src/components/DeviceAnalytics.tsx`, `src/routes/_cloud/connections.usage.tsx`, `src/lib/usage.functions.ts`, `public/nodered-template.json`, `docs/nodered-integration.md`.
