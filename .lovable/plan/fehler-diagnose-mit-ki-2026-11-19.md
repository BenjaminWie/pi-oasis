# Fehler-Diagnose mit KI

Ein neuer Bereich **Diagnose** in der lokalen Pi-Oberfläche: Fehlerprotokoll einfügen, KI nennt wahrscheinliche Ursache und konkrete Lösungsschritte — auf Deutsch, Schritt für Schritt.

## Was der Nutzer sieht

Neuer Tab **Diagnose** (Lupe-Symbol) neben Debug:

- Großes Textfeld: Fehlermeldung oder Protokollzeilen einfügen (bis 20.000 Zeichen).
- Knopf **„Letzte Debug-Zeilen übernehmen"** — füllt das Feld automatisch mit den letzten Fehler-/Info-Zeilen aus dem Debug-Verlauf, damit nichts manuell kopiert werden muss.
- Schalter **„Endpunkt-Konfiguration mitschicken"** (standardmäßig an): schickt die aktuell angemeldeten Endpunkte samt Bezeichnung, Art, Einheit, Grenzen und letztem Wert mit.
- Optionales Feld: „Was hast du gerade versucht?" (z. B. „Pumpe über Alexa geschaltet").
- Knopf **Analysieren**. Die Antwort erscheint fortlaufend, während die KI denkt.

Die Antwort ist immer gleich aufgebaut:

1. **Wahrscheinliche Ursache** in einem Satz, mit Einschätzung wie sicher das ist.
2. **Weitere mögliche Ursachen** (kurze Liste).
3. **Lösungsschritte** — nummeriert, konkret, jeder Schritt mit dem, was danach zu sehen sein sollte.
4. **Betroffene Endpunkte oder Einstellungen**, falls erkennbar.

Darunter: Knopf „Antwort kopieren" und „Neu analysieren". Nichts wird dauerhaft gespeichert — die Analyse lebt nur in der geöffneten Seite.

## Wenn etwas fehlt

- Ohne eingegebenen Text bleibt der Knopf inaktiv.
- Ist der KI-Zugang nicht verfügbar oder das Guthaben aufgebraucht, erscheint die echte Meldung im Klartext („Guthaben aufgebraucht" mit Hinweis, wo es aufgeladen wird), nicht eine erfundene Antwort.
- Der Bereich funktioniert auch ohne verbundenen Pi: dann fehlen nur die Endpunkt-Angaben.

## Technische Umsetzung

- **Route:** `src/routes/_authenticated/diagnose.tsx` (`ssr: false`, eigener `head()` mit Titel/Beschreibung), Eintrag in `src/components/BottomNav.tsx` (Debug und Diagnose teilen sich einen Slot: Diagnose als sechster Tab, Reihenfolge Overview · Steuerung · Debug · Diagnose · System, MQTT wie bisher dynamisch).
- **Kontext-Sammler:** neue Serverfunktion `collectDiagnosticsFn` in `src/lib/diagnose.functions.ts` mit `requirePiAuth` — liefert `debugEntries(120)` (gefiltert auf `err`/`info`), `listEndpoints()` aus `registry.server` und `registryInfo()`, gekürzt auf das Nötige.
- **KI-Aufruf:** Server-Route `src/routes/api/diagnose.ts` (POST, geschützt über denselben `X-Pi-Auth`-Token wie die Serverfunktionen, per `verifyPiToken` im Handler). Streaming mit `streamText` über `createLovableAiGatewayProvider` aus `src/lib/ai-gateway.server.ts`, Modell `google/gemini-3.6-flash` wie im bestehenden Assistenten. Keine Tools — reine Textanalyse. Eingabe mit Zod validiert (`logs`, `attempted?`, `includeConfig`), Endpunktliste wird serverseitig geholt, nie vom Client geschickt.
- **Systemprompt** in neuer Datei `src/lib/diagnose-brain.server.ts`: deutschsprachiger Pi-Control-Diagnostiker, kennt den Aufbau (Node-RED meldet Endpunkte an, Relay/Alexa/Telegram, lokaler 48-h-JSONL-Speicher), muss die vier Abschnitte oben liefern, darf keine Endpunkte erfinden und soll offen sagen, wenn die Protokollzeilen nicht ausreichen.
- **Client:** `useChat` entfällt; einfacher `fetch` mit Stream-Lesen und Markdown-Darstellung über die vorhandenen `ai-elements`-Bausteine (`MessageResponse`, `Shimmer`). Fehlerantworten kommen als JSON mit `code` und werden im Klartext angezeigt.
- Kein Datenbankzugriff, keine neuen Tabellen, keine zusätzlichen Abfragezyklen — der Aufruf passiert nur auf Knopfdruck.
