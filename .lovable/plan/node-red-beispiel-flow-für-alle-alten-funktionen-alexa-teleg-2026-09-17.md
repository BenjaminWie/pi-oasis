# Node-RED Beispiel-Flow für alle alten Funktionen + Alexa/Telegram mit Debug

Der neue Flow kann bisher nur „Pumpe an/aus" und ein paar Werte. Er bekommt jetzt alle Funktionen zurück, die du vorher hattest — und Alexa und Telegram werden im Debug-Tab sichtbar und testbar.

## 1 · Beispiel-Flow mit allen alten Anwendungsfällen

Ein einziger Katalog-Baustein meldet diese Endpunkte an, gruppiert:

Gruppe Pumpe
- Pumpe (Schalter, MQTT an/aus)
- Pumpenleistung in Watt (Anzeige)
- Laufzeit heute in Minuten (Anzeige)
- Bewässerung jetzt starten, mit Dauer in Minuten (Aktion)
- Nachtruhe (Schalter — blockt Bewässerung abends/nachts)

Gruppe Energie
- PV-Überschuss in Watt (Anzeige)
- Aktueller Strompreis in Cent (Anzeige)
- Nur bei Überschuss pumpen (Schalter)
- Überschuss-Schwelle in Watt (Zahl, 0–3000)

Gruppe Wetter
- Außentemperatur (Anzeige)
- Regen nächste 24 h in mm (Anzeige)
- Regen-Sperre in mm (Zahl, 0–20 — darüber wird nicht bewässert)

Gruppe System
- CPU, Arbeitsspeicher, Speicherplatz, Temperatur, Laufzeit, MQTT-Broker erreichbar (Anzeigen)

Gruppe Strategie
- Strategie (Auswahl: Automatik / Nur Überschuss / Immer / Aus)
- Zuletzt angewandte Regel + Begründung (Anzeige)

Dazu im Flow:
- Werte-Sammler: MQTT-Themen und Sensorwerte werden auf diese Endpunkt-Namen abgebildet, mit 5-Sekunden-Entprellung wie bisher.
- Regel-Baustein: entscheidet alle 5 Minuten anhand Überschuss, Preis, Regen und Nachtruhe, ob gepumpt wird, und schreibt Ergebnis plus Begründung zurück.
- Kommando-Eingang für alle Schalter, Zahlen und Aktionen (eine Adresse, wie jetzt).
- Fehler- und Trace-Kanal in den Debug-Stream.

Der Flow bleibt selbstkonfigurierend: Adresse und Token holt er sich beim Deploy vom Pi, kein Copy-Paste.

## 2 · Alexa und Telegram mit Debug-Optionen

Debug-Tab bekommt drei Ergänzungen:

- Kanal-Filter: Alles / Node-RED / Alexa / Telegram / Chat / Regeln — jede Anfrage steht mit Kanal, erkannter Absicht, betroffenem Endpunkt, Antworttext und Dauer da.
- Testfeld „so als käme es von Alexa / von Telegram": Satz eintippen, abschicken, Antwort und ganzer Verlauf erscheinen sofort im Stream — ohne echtes Gerät.
- Ausführliches Protokoll ein/aus (pro Kanal), inklusive der rohen Anfrage und der Antwort, für die Fehlersuche. Standard: aus.

Zusätzlich in Feintuning: pro Endpunkt bleibt „für Sprache sichtbar" und „darf geschaltet werden" — Alexa und Telegram sehen genau das und nichts mehr.

Alexa bekommt für die neuen Endpunkte passende Sätze (Bewässerung starten, Nachtruhe, Strategie, Überschuss, Regen), Telegram dieselben plus Kurzbefehle `/pumpe`, `/status`, `/preis`, `/regen`, `/strategie`, `/debug`.

## 3 · Anleitung im UI

Auf der Node-RED-Seite: Flow herunterladen, importieren, Deploy, Selftest — mit Hinweis, welche MQTT-Themen du für dein Setup im Katalog-Baustein anpasst.

## Technische Details

- `public/nodered-template.json` neu: Katalog-Node mit den oben genannten Endpunkten, Werte-Mapper, Regel-Tick (5 min), Kommando-Eingang, Catch → Trace.
- `src/lib/nodered-personalize.server.ts` / `nodered-config.server.ts`: zusätzliche Platzhalter für die neuen MQTT-Themen und Schwellen.
- `src/lib/registry.server.ts`: `debugLog` erhält `channel` (`node-red` | `alexa` | `telegram` | `chat` | `rules`) plus optional `verbose`-Nutzlast; Filter und Verbose-Schalter in `src/routes/_authenticated/debug.tsx`.
- `src/lib/voice-intents.server.ts`: Intents für Bewässerung/Nachtruhe/Strategie/Regen ergänzt, jede Runde protokolliert Kanal + Absicht + Endpunkt + Antwort.
- Neue Server-Funktion `simulateVoice` (Kanal + Satz) für das Testfeld, geschützt über die bestehende Pi-Authentifizierung.
- `src/routes/api/public/voice/alexa.ts` und `telegram/webhook.ts`: nur Protokollierung ergänzen, Logik bleibt in den Intents.
