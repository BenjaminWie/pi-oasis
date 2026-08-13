# Node-RED lokal stabilisieren: Telemetrie, Trace und WebSocket

## Ziel

Der Pi-Flow soll lokal vollständig funktionieren, auch wenn die Cloud nicht erreichbar ist. Systemwerte werden wieder korrekt an `/ingest/live` gesendet, Trace-Logs bleiben aussagekräftig und ein nicht verfügbarer Cloud-WebSocket erzeugt keine Reconnect-Flut mehr.

## Bestätigte Ursachen

- `Build Live Telemetry Request` enthält als einziger der 22 Function-Nodes einen Syntaxfehler: Nach dem Token-Fallback steht eine überzählige `});`.
- Im selben Node fehlt zusätzlich die frühere Umwandlung des `exec`-JSON in ein validiertes `tick`-Objekt. Selbst nach Entfernen der Klammer wäre `tick` daher nicht definiert.
- Der lokale Clone wird aktuell vor der Aufbereitung erzeugt. Dadurch würde der lokale Live-Sink das rohe `exec`-Ergebnis statt normalisierter CPU-/RAM-/Disk-/Temperaturwerte erhalten.
- Der WebSocket-Trace dedupliziert nur identische Texte. Node-RED wechselt aber zwischen `common.status.error` und `common.status.disconnected`; dadurch wird alle drei Sekunden ein neuer Fehler gespeichert.
- Wenn beim personalisierten Download keine WebSocket-URL aufgelöst werden kann, bleibt der statische Socket-Client mit leerem `${CLOUD_WS_URL}` im Flow und versucht trotzdem fortlaufend neu zu verbinden.

## Umsetzung

### 1. System-Telemetrie reparieren

- Die vollständige Parser- und Normalisierungslogik im Node `Build Live Telemetry Request` wiederherstellen.
- Nur finite Werte für CPU, RAM, Swap, Disk, Temperatur und Uptime übernehmen und immer einen Zeitstempel setzen.
- Erst aus dem fertigen Tick getrennte Cloud- und Lokal-Nachrichten erzeugen.
- Cloud-Ausgabe bei fehlendem/gesperrtem Token unterdrücken, lokale Ausgabe jedoch unverändert weiterführen.
- Lokale Live-Daten über `/api/public/ingest/live` in die bestehende 48-h-Ablage schreiben.

### 2. WebSocket-Reconnect-Flut stoppen

- WebSocket-Zustände auf `connected` und `down` normalisieren, sodass `error` und `disconnected` als derselbe Ausfall gelten.
- Nur echte Zustandswechsel speichern; einen fortbestehenden Ausfall höchstens als stark gedrosselte Erinnerung melden.
- Beim personalisierten Download ohne aufgelöste WebSocket-URL die WebSocket-, Join-, Heartbeat- und Status-Nodes aus der erzeugten Importdatei entfernen. Der 15-Minuten-Safety-Poll bleibt aktiv.
- In der Integrationsseite klar anzeigen, dass der heruntergeladene Flow lokal/Safety-Poll-fähig ist und nach Wiederherstellung der Cloud erneut heruntergeladen werden muss, um WebSocket-Push zu aktivieren.

### 3. Diagnose verständlich halten

- Selftest weiterhin lokal unabhängig auswerten: `local/config`, `local/event`, `local/live` und `local/trace` müssen ohne Cloud testbar sein.
- Einen lokalen Live-Test ergänzen bzw. sicherstellen, damit der Telemetriepfad im Selftest sichtbar bestätigt wird.
- Health-Einträge nach Ziel trennen und für den WebSocket nur den normalisierten letzten Zustand zählen, statt jeden internen Node-RED-Statuswechsel.
- Die Anleitung um die konkreten Fehlerbilder `Unexpected token ')'`, fehlende WebSocket-URL und „Cloud aus, lokal aktiv“ ergänzen.

## Validierung

- Das JSON-Template vollständig parsen und alle Function-Nodes mit dem JavaScript-Parser prüfen; Ziel: `INVALID=0`.
- Den personalisierten Export in zwei Varianten prüfen: mit WebSocket-URL und ohne WebSocket-URL.
- Den Telemetrie-Builder mit gültigem `exec`-JSON, ungültigem JSON und fehlendem Cloud-Token testen.
- Prüfen, dass der lokale Live-Sink ein normalisiertes Tick-Objekt erhält und Cloud-Ausfall den lokalen Pfad nicht blockiert.
- Prüfen, dass alternierende `error`/`disconnected`-Meldungen nur einen `down`-Health-Eintrag erzeugen.

## Nutzung nach dem Update

Den bestehenden importierten Tab in Node-RED ersetzen, nicht zusätzlich importieren. Danach den neuen personalisierten Flow aus `Node-RED & Integrationen` laden, importieren, deployen und den Selftest ausführen.