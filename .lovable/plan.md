
## Analyse (aus den Daten in der Cloud)

**Pumpen-Leistung real gemessen (pump_guard-Events):**
- 04.07.: Ø 513 W, max 527 W (4 Samples, 3 Zyklen à 10 min)
- 03.07.: Ø 516 W, max 520 W (3 Zyklen)
- 02.07.: Ø 511 W, max 521 W (3 Zyklen)
- 01.07.: Ø 509 W, max 517 W (manuelle Kurzläufe)

Die "600 W" in den `pump_control`-Events sind der geplante Sollwert (nicht Messung). Der Pulse misst real ~510 W.

**Warum du das im Tibber-Chart (6h) kaum siehst:**
- Deine 3 Zyklen heute liefen **08:52–09:02, 09:17–09:27, 09:32–09:42** — der 6-Std.-Chart beginnt aber erst ~09:20. Nur die letzten 1½ Zyklen fallen ins Fenster.
- Ohne Pumpe exportierst du gerade ~-500 W. Wenn die Pumpe 510 W zieht, wird der Export auf ~0 W gedrückt (Peaks nach oben, aber selten positiv). Die drei Spitzen zwischen 11:00–11:30 im Tibber-Chart passen dazu — kein sichtbarer +600-W-Peak, weil die PV den Verbrauch fast komplett deckt.
- Der Pulse aggregiert im 6-Std.-Fenster; kurze 10-min-Läufe werden geglättet. In der **5-min-Ansicht** sind sie deutlicher zu sehen.

**Fazit:** Die Pumpe läuft korrekt (~30 min/Tag, ~510 W), du "siehst" sie stromseitig kaum, weil PV alles auffängt — genau das Ziel der Eco-Automatik.

---

## UI-Änderungen (nur Frontend, `src/routes/_cloud/pump.tsx`)

1. **Strategie einklappbar**
   - Karte "Strategie (Cloud → Pi & Node-RED)" in einen `Collapsible` verpacken (Trigger als Karten-Header mit Chevron).
   - Standard: **eingeklappt**. State merken pro Session.
   - Bei `eco_paused` weiterhin Hinweistext beim Aufklappen.

2. **Reihenfolge auf der Seite** (damit oben Steuerung, unten Verlauf sichtbar bleibt)
   - Live-Karte (unverändert)
   - Manuelle Steuerung (Start / Stopp / Eco-Pause)
   - Diagnose-Strip + Test-Button (unverändert)
   - **Strategie (collapsible, default zu)** ← verschoben nach oben
   - History-Chart (48h)
   - Debug-Zeile
   - **Letzte Entscheidungen (endlos scrollbar)**

3. **Endlos-Scroll für "Letzte Entscheidungen"**
   - Query-Limit von 100 → dynamisch (Start 100, Button "Mehr laden" +200, bis 1000).
   - Cap `max-h-72` entfernen, stattdessen natürliche Höhe + eigener Scroll-Container mit `max-h-[70vh]` und "Ende erreicht"-Hinweis wenn keine weiteren Events mehr kommen.
   - Query-Key um `limit` erweitern, `listDeviceEvents` unterstützt bereits `limit` bis 500 — Backend erhöhen wir auf 2000 (nur Zod max ändern in `src/lib/control.functions.ts`, kein Logikwechsel).

### Betroffene Dateien
- `src/routes/_cloud/pump.tsx` (Layout, Collapsible, Pagination-Button)
- `src/lib/control.functions.ts` (Zod max 500 → 2000)

Keine Datenbank- oder Node-RED-Änderungen nötig.
