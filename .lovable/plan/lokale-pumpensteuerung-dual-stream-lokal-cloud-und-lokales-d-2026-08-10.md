# Lokale Pumpensteuerung, Dual-Stream (lokal + Cloud) und lokales Debugging

Ziel: Die Pumpen-Oberfläche, die es bisher nur in der Cloud-App gibt (`/pump`), gibt es auch in der lokal auf dem Pi laufenden App — inklusive Live-Werten, Verlauf, Entscheidungen und einem Debug-Bereich. Node-RED sendet jeden Datenpunkt gleichzeitig an die Cloud **und** an die lokale App, und die lokale App bewahrt alles 2 Tage in ihrem eigenen Speicher auf, damit Statistiken auch offline nachvollziehbar sind.

## Was du danach hast

- Neue lokale Seite **Pump** (im Pi-Dashboard, verlinkt aus der Plugin-Detailseite): Live-Watt/PV/Temperatur, Ein/Aus-Zustand, Force ON / Force OFF, Verlaufs-Chart der letzten 48 h, Entscheidungs-Timeline — dieselbe Struktur wie die Cloud-Seite, aber ausschließlich mit lokalen Daten.
- Live-Werte kommen ohne Nachladen an: Node-RED streamt in die lokale App, die App schiebt sie per Live-Verbindung in die offene Seite. Die Cloud bekommt weiterhin parallel denselben Tick.
- Ein **Debug**-Bereich auf der lokalen Seite: die letzten Requests mit Request-ID, Route, Status, Grund einer Ablehnung, Roh-Payload, sowie „zuletzt gesehen" pro Komponente. Damit siehst du lokal sofort, was gesendet und was verworfen wurde — auch wenn die Cloud gerade nicht erreichbar ist.
- Alles (Events, Live-Ticks, Entscheidungen, Traces) liegt 2 Tage im App-Speicher unter `~/.pi-hub/` und wird automatisch älter als 48 h gelöscht.
- Fällt das Internet aus, läuft die lokale Anzeige und Steuerung weiter; die Cloud bekommt später nichts nachgereicht (kein Backfill — bewusst, um Datenbank-Kosten nicht hochzutreiben).

## Umsetzung

### 1. Lokaler 48-Stunden-Speicher

Neu: `src/lib/local-timeseries.server.ts` (ersetzt den reinen RAM-Puffer `local-ingest-buffer.server.ts`, der als Schreib-Cache erhalten bleibt).

- Tagesdateien als JSONL unter `~/.pi-hub/telemetry/<kind>-<YYYY-MM-DD>.jsonl` (`kind` = `event` | `tick` | `decision` | `trace`), Modus `0600`.
- Gepuffertes Schreiben (Flush alle 5 s oder ab 50 Zeilen), damit die SD-Karte bei 2 s-Ticks nicht dauerbeschrieben wird; Ticks werden zusätzlich auf max. 1 Zeile / 15 s heruntergerechnet, der Live-Stream bleibt voll aufgelöst.
- Beim Flush werden Dateien älter als 2 Tage gelöscht (Retention über `PI_HUB_RETENTION_HOURS`, Default 48).
- Lesefunktionen: `readRange(kind, sinceIso)`, `hourlyBuckets(sinceIso)` (Mittelwerte für Watt/Temp/PV je Stunde), `lastSeenByComponent()`.

### 2. Lokale Aufnahme + Live-Fanout

- `src/routes/api/public/ingest/event.ts`: schreibt zusätzlich in den neuen Speicher und beantwortet den Request mit `rid` (gleiche Trace-Semantik wie die Cloud-Endpunkte: `received`, `stored`, `dropped`, Grund).
- Neu `src/routes/api/public/ingest/live.ts`: nimmt dieselben Tick-Felder an wie `/api/public/live/publish` (Watt, PV, Temperatur, `pump_on`, System-Werte), legt sie in den Speicher und gibt sie an alle offenen lokalen Clients weiter.
- Neu `src/routes/api/public/ingest/trace.ts`: nimmt Trace-/Fehlerzeilen aus Node-RED entgegen (Route, Status, Dauer, Grund, gekürzter Body).
- Neu `src/lib/local-live-bus.server.ts`: In-Process-Emitter.
- Neu `src/routes/api/live-stream.ts`: Server-Sent-Events-Stream für die lokale UI, geschützt über die bestehende Pi-Session-Auth. (SSE statt eigenem WebSocket-Server, weil die lokale App unter Vite/Node ohne zusätzlichen WS-Server auskommt; für die Seite verhält es sich identisch — Push in Echtzeit, automatische Wiederverbindung.)

### 3. Lokale Pump-Seite

Neu `src/routes/_authenticated/pump.tsx` plus Eintrag in `src/components/BottomNav.tsx` und ein Link „Pump-Ansicht" auf `plugins.$id.tsx`.

Aufbau angelehnt an `src/routes/_cloud/pump.tsx`, aber lokal gespeist:
- Live-Kachel (Watt, PV, Außentemperatur, Pumpenstatus, Alter des letzten Ticks) aus dem SSE-Stream, Startwert aus dem 48-h-Speicher.
- Chart der letzten 48 h aus `hourlyBuckets` (dieselben umschaltbaren Reihen: Watt, Temp, Regen, PV).
- Force ON / Force OFF / Re-plan über die bestehenden `plugins.functions` (`manualAction`, `runPlannerNow`) für das Pump-Plugin; ohne Plugin ein Hinweis mit Link zum Anlegen.
- Entscheidungs-Timeline aus dem Plugin-Store, ergänzt um lokal empfangene `pump_control`-Events.
- Klappbarer Debug-Bereich: Trace-Liste (rid, Route, Status, ms, Grund), letzte Roh-Payloads, „zuletzt gesehen" pro Komponente, Filter „nur Fehler".

Neue Server-Funktionen in `src/lib/local-telemetry.functions.ts` (alle mit `requirePiAuth`): `getLocalPumpState`, `getLocalBuckets`, `getLocalTraces`.

### 4. Node-RED Template (`public/nodered-template.json`)

- Neue Tab-Env-Werte: `LOCAL_BASE_URL` (Default `http://127.0.0.1:8080`), `PI_INGEST_TOKEN`, `LOCAL_SINK` (`on`/`off`).
- Jeder bestehende Zweig (Event, Live-Telemetrie, Command-Result) bekommt einen zweiten Ausgang auf einen neuen „Local Sink"-Zweig, der denselben Body mit derselben `rid` an `LOCAL_BASE_URL` schickt. Cloud- und Lokal-Push laufen unabhängig — ein Fehler auf einer Seite stoppt die andere nicht.
- Der bestehende Trace-Zweig schickt seine Zeilen zusätzlich an `/api/public/ingest/trace`, sodass das Debug-Panel der App dieselben Informationen hat wie das Node-RED-Debug-Fenster.
- Die bestehende Cloud-WebSocket-Gruppe (Command-Empfang über Supabase Realtime) bleibt unverändert; nur ein Statuszweig meldet Verbindungsauf-/-abbau zusätzlich an den lokalen Trace-Endpunkt, damit Verbindungsprobleme lokal sichtbar sind.

### 5. Doku

`docs/nodered-integration.md`: neuer Abschnitt „Dual-Sink: lokal + Cloud" — die drei lokalen Endpunkte, die neuen Env-Werte, Retention (2 Tage), und eine Tabelle „wo schaue ich nach, wenn X fehlt" (lokales Debug-Panel vs. Cloud-Usage-Seite).

## Hinweise

- Keine Datenbankänderung und kein zusätzlicher Cloud-Traffic: die lokale Kopie läuft komplett am Pi vorbei an der Datenbank.
- Der lokale Ingest ist weiterhin nur aus dem LAN bzw. mit `PI_INGEST_TOKEN` erreichbar.
- Beim Import des aktualisierten Node-RED-Templates müssen `LOCAL_BASE_URL` und `PI_INGEST_TOKEN` einmal gesetzt werden.
