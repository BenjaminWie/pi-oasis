# Node-RED Setup ohne Token-Copy-Paste

Ziel: Du importierst **eine Datei**, drückst Deploy — fertig. Keine Tab-Env-Felder mehr von Hand füllen, keine Tokens suchen, und ein Selbsttest, der dir in Klartext sagt, was funktioniert und was nicht.

## Was in deinem aktuellen Flow (`flows_12.json`) schiefläuft

Bestätigt aus dem Export:

1. **Alle Geheimnisse sind leer.** `CLOUD_DEVICE_TOKEN`, `PI_INGEST_TOKEN`, `CLOUD_WS_URL`, `CLOUD_DEVICE_ID` sind `""`. Damit brechen Event-Push, Strategy-Poll, Command-Result und der WebSocket-Kanal alle sofort ab — genau das Verhalten, das du siehst.
2. **Henne-Ei beim WebSocket.** Der `websocket-client` braucht eine feste URL im Config-Node, die URL kommt aber erst aus dem Bootstrap-Request. Der Flow schreibt dir die URL nur als `node.warn` ins Debug-Fenster und erwartet, dass du sie manuell in die Tab-Env kopierst und neu deployst.
3. **Inkonsistente Quellen.** „Build Command Poll" liest `global.get('CLOUD_DEVICE_TOKEN')` und `global.get('CLOUD_COMMAND_POLL_URL')` — diese Globals werden nirgends gesetzt. Der Safety-Net-Poll feuert also nie, auch wenn die Tab-Env korrekt gefüllt ist. Andere Nodes lesen `env.get`, „Build Phoenix Join" liest env → global → flow. Drei verschiedene Muster im selben Tab.
4. **Falscher lokaler Port.** `LOCAL_API_URL` zeigt auf Port `3000`; die App läuft im Dev-Betrieb auf `8080`. Der lokale Fallback läuft damit ins Leere.
5. **Lokal existiert nur als Fallback.** Der Export kennt nur `/ingest/event` und nur dann, wenn die Cloud vorher gescheitert ist. Die neuen lokalen Endpunkte (`/ingest/live`, `/ingest/trace`, 48-h-Historie, `/pumpe`-Seite) werden nie beliefert.

Denkfehler dahinter: Konfiguration wird **in Node-RED gepflegt**, obwohl die einzige Instanz, die alle Werte wirklich kennt (Token, Device-ID, LAN-IP, Port), die Pi-App ist. Der Plan dreht die Richtung um.

## Die Lösung

### 1. Ein Selbstkonfigurations-Endpunkt auf dem Pi

Neu `src/routes/api/public/nodered/config.ts` (LAN-only bzw. mit `PI_INGEST_TOKEN`, gleicher Guard wie die Ingest-Routen). Liefert genau das, was der Flow braucht:

```text
cloud: { eventUrl, strategyUrl, liveUrl, commandPollUrl, commandResultUrl,
         deviceToken, deviceId, wsUrl, channel }
local: { baseUrl, eventUrl, liveUrl, traceUrl, token }
mqtt:  { commandTopic, brokerHost, brokerPort }
```

Der Cloud-Teil wird serverseitig einmal über `/api/public/agent/realtime` aufgelöst und gecacht, damit der Flow den Bootstrap nicht selbst fahren muss.

### 2. Personalisierter Flow-Download (löst das WebSocket-Henne-Ei)

`/integrations` bekommt einen Button **„Flow personalisiert herunterladen"**. Eine Server-Funktion nimmt `public/nodered-template.json`, ersetzt alle Tab-Env-Werte und die URL im `websocket-client`-Config-Node durch die echten Werte und liefert die Datei aus. Import → Deploy → läuft. Der generische Download bleibt daneben bestehen.

Die Datei enthält deinen Device-Token im Klartext (nötig, damit Node-RED sie ohne Nacharbeit nutzen kann) — der Button steht deshalb hinter der Pi-PIN-Session und der Download bekommt einen deutlichen Hinweis.

### 3. Ein Konfigurationsmuster statt drei

Neuer Node „Pi-Hub Config laden" (Inject on Deploy + alle 30 min): holt `/api/public/nodered/config` vom Pi und legt alles unter `global.pihub` ab. Alle Funktions-Nodes bekommen denselben Zweizeiler:

```javascript
const cfg = global.get('pihub') || {};
if (!cfg.cloud?.deviceToken) { node.status({fill:'red',shape:'ring',text:'no config'}); return null; }
```

Damit verschwinden `env.get`/`global.get`-Mischungen, und wenn du in der Pi-UI neu pairst, zieht Node-RED den neuen Token binnen 30 min von selbst — ohne Deploy.

### 4. Dual-Sink vervollständigen

Event-, Live-Tick-, Command-Result- und Trace-Zweig bekommen je einen zweiten Ausgang auf die lokalen Endpunkte mit derselben `rid`. Cloud-Fehler stoppen den lokalen Push nicht und umgekehrt. Damit füllt sich die lokale 48-h-Historie und `/pumpe` zeigt auch ohne Internet echte Werte.

### 5. Selbsttest — sagt dir, was kaputt ist

Neuer Inject-Node **„Pi-Hub Selftest"** (und Autostart 20 s nach Deploy) prüft nacheinander: Config-Fetch, Cloud-Event, Strategy, Live-Publish, lokaler Event-Sink, lokaler Trace-Sink, WebSocket-Status. Ausgabe als eine kompakte Tabelle ins Debug-Fenster:

```text
config    OK    (device drainpress, token a1b2c3…)
cloud/evt OK    201  rid evt-x1y2
strategy  FAIL  401  -> Token abgelaufen, in Pi-UI neu pairen
local/evt OK    200
websocket OK    joined commands:8f3…
```

Dasselbe Ergebnis geht an `/api/public/ingest/trace`, sodass es in der Pi-UI unter `/integrations` als **Integration-Health-Karte** erscheint (letzter Selbsttest, letzter Kontakt pro Route, letzter Fehlergrund).

### 6. Doku neu schreiben

`docs/nodered-integration.md` wird auf einen 5-Schritte-Kurzweg vorne gekürzt (Pairen → personalisierten Flow laden → importieren → Deploy → Selbsttest) plus eine Troubleshooting-Tabelle „Fehlermeldung → Ursache → Fix". Der bestehende Referenzteil (Payload-Schemata, WebSocket-Contract) rutscht nach hinten.

## Technische Hinweise

- Keine Datenbankänderung, kein zusätzlicher Cloud-Traffic. Der Config-Endpunkt läuft rein auf dem Pi; nur der Realtime-Bootstrap ruft einmalig die Cloud.
- Der WS-Config-Node bleibt statisch; die Personalisierung beim Download ersetzt seine `path`-Eigenschaft. Zusätzlich meldet ein Status-Zweig Verbindungsabbrüche an den lokalen Trace-Endpunkt.
- Betroffene Dateien: neu `src/routes/api/public/nodered/config.ts`, `src/lib/nodered-config.server.ts`; geändert `src/lib/integrations.functions.ts`, `src/routes/_authenticated/integrations.tsx`, `public/nodered-template.json`, `docs/nodered-integration.md`.
