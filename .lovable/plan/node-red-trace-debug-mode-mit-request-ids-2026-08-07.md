# Node-RED Trace-/Debug-Mode mit Request-IDs

Ziel: Für jeden Push aus Node-RED (Event, Live-Telemetrie, Command-Result) siehst du im Node-RED-Debug genau, **was gesendet**, **was angekommen** und **was verworfen** wurde — anhand einer eindeutigen Request-ID, die beide Seiten teilen.

## Was du danach hast

- Jeder ausgehende Request trägt eine Request-ID (`rid`), z. B. `evt-1a2b3c`.
- Die Cloud gibt die gleiche ID in der Antwort zurück, zusammen mit `inserted`, `deduped`, `throttled`, `mirrored` bzw. Fehlergrund.
- Ein zentraler Trace-Zweig im Flow schreibt pro Request eine kompakte Zeile ins Debug-Panel:
  `evt-1a2b3c → POST /cloud-bridge/event | 2 Events | 200 | inserted 1, deduped 1 (312 ms)`
- Ein Schalter (`TRACE_MODE` in den Tab-Env-Werten) macht daraus bei Bedarf die volle Ausgabe inkl. gesendetem Body und roher Antwort. Aus = nur Fehler werden geloggt.
- Ein lokaler Ringpuffer der letzten 50 Traces im Flow-Context, abrufbar über einen Inject-Node „Trace Report" — auch wenn das Debug-Panel gerade nicht offen war.

## Änderungen

### 1. Node-RED Template (`public/nodered-template.json`)

- Neue Gruppe „Trace / Debug" mit:
  - `pihub_trace_log` (function): nimmt jede Antwort/Fehler entgegen, baut die Trace-Zeile, hängt sie in den Ringpuffer `flow.trace` und gibt sie je nach `TRACE_MODE` (`off` / `errors` / `full`) aus.
  - `pihub_trace_debug` (debug): Ausgabe im Debug-Panel.
  - `pihub_trace_report` (inject + function): druckt die letzten 50 Traces gesammelt.
- Alle vier Build-Nodes (`Build Cloud Event Request`, `Build Live Telemetry Request`, `Build Command Result`, `Build Strategy Request`) erzeugen `msg.rid`, setzen den Header `x-request-id`, merken sich `msg.traceSent` (Route, Body-Größe, Anzahl Events, Startzeit).
- Alle HTTP-Nodes bekommen `Return: full response object` bzw. behalten `msg.statusCode`, damit auch 4xx/5xx sichtbar sind statt still zu enden; ihre Ausgänge (inkl. Catch-Node) laufen zusätzlich in `pihub_trace_log`.
- Neue Tab-Env-Werte: `TRACE_MODE` (Default `errors`).

### 2. Server: Request-ID annehmen und zurückgeben

- `src/lib/agent-api.server.ts`: Helper `requestId(request)` (liest `x-request-id`, sonst generiert) und `jsonResponse` um optionalen `rid` erweitern, der als Feld im Body **und** als `x-request-id`-Header zurückkommt.
- `src/routes/api/public/cloud-bridge/event.ts`: `rid` in allen Antworten (auch 401/400/500), plus Zähler `received`, `inserted`, `deduped`, sodass „verworfen" = `received - inserted` eindeutig ist.
- `src/routes/api/public/live/publish.ts`: `rid` zurückgeben plus `broadcast: true/false`, `system_mirrored: true/false` und bei Throttling `throttled: true` mit `retry_in_ms` — genau das, was heute unsichtbar verworfen wird.
- `src/routes/api/public/agent/result.ts` und `.../cloud-bridge/strategy.ts`: `rid` durchreichen.

Kein Datenbank-Write kommt dazu; Tracing bleibt reine Antwort-Metadaten plus lokales Node-RED-Log.

### 3. Doku

- `docs/nodered-integration.md`: neuer Abschnitt „Trace-/Debug-Mode" — `TRACE_MODE`-Werte, Aufbau der Trace-Zeile, Bedeutung von `deduped` / `throttled` / `system_mirrored`, und eine kurze Tabelle „Symptom → was im Trace steht".

## Hinweis

Import des aktualisierten Templates ersetzt die bestehenden Nodes mit gleichen IDs; die Tab-Env-Werte (`CLOUD_DEVICE_TOKEN` etc.) musst du nach dem Import einmal prüfen bzw. `TRACE_MODE` ergänzen.
