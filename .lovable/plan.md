
## Diagnose

Die Rollups laufen (8 Tage in `device_events_daily`, 231 Zeilen in `device_events_hourly`), aber alle relevanten Spalten sind `0` / `NULL`. Ursachen:

1. **Pumpenminuten**: `aggregate_device_events()` liest `metrics->>'minutes'` aus `pump_control`. Node-RED sendet dieses Feld nicht — es liefert `state`, `watts`, `today_total_runtime_min`. Ergebnis: `pump_minutes = 0` überall.
2. **PV-Deckung**: Aggregator holt `pv_surplus_avg` aus `pump_control`-Zeilen. `pv_surplus_watt` steckt aber ausschließlich in `eco_intelligence`. Kein Wert → `pv_covered_pct` immer NULL.
3. **Regen**: Aggregator sucht Component `weather_dwd` und Feld `precipitation_mm`. Beides existiert nicht. Regenwerte kommen von `eco_intelligence.forecast_rain_mm` bzw. `past_night_rain_mm`. Deshalb ist die Regen-Fläche im 48h-Chart leer und Rollups liefern NULL.
4. **Chart-Achsen**: `Regen` teilt sich die rechte Achse (0–32) mit `Temp`. Selbst wenn Werte kämen, wären 0.5 mm gegen 29 °C unsichtbar. Braucht eigene, unsichtbare Skala.

## Plan

### 1. Aggregator-Migration (fixt Rollups + Backfill)
Neue Fassung von `aggregate_device_events()` und `aggregate_device_events_daily()`:

- **Pumpenminuten pro Bucket**: `max(today_total_runtime_min) - min(today_total_runtime_min)` aus `pump_control` (clampen auf ≥0; über Tagesgrenze wird ohnehin neu bei 0 gestartet).
- **Zyklen**: Anzahl Übergänge `state 0 → 1` (via LAG).
- **kWh**: `minuten × 0.51 / 60` (gemessene ~510 W).
- **PV-aktiv pro Stunde**: Flag aus `eco_intelligence.pv_surplus_watt > pv_min_w` (Fallback 200 W).
- **Tages-PV-Deckung**: Pump-Minuten in PV-aktiven Stunden ÷ gesamte Pump-Minuten × 100.
- **Regen Stunde**: `max(forecast_rain_mm)` + neue Spalte `rain_past_night_max` aus `eco_intelligence`.
- **Regen Tag**: `max(past_night_rain_mm)` als robuste Approximation.
- **Backfill**: Einmalig Fenster auf `now() - interval '30 days'` erweitern und die beiden Aggregate-Funktionen ausführen, damit historische Tage befüllt werden.

### 2. Chart: eigene Regen-Achse
In `src/routes/_cloud/pump.tsx`:
- Dritter `<YAxis yAxisId="rain" hide domain={[0, (max) => Math.max(5, max * 1.5)]} />`.
- Regen-`<Area>` an `yAxisId="rain"` binden, `type="stepAfter"`, kräftigere Opacity (0.35), gestrichelte Kante.
- Damit bleibt Temp/PV/Watt-Layout unverändert, Regen skaliert unabhängig und ist auch bei 0.2 mm sichtbar.
- `chartData` liest zusätzlich `rain_past_night_max` (falls verfügbar) und nutzt den höheren der beiden Werte.

### 3. PumpInsights
Kein Code-Change nötig — sobald Punkt 1 durchläuft, füllen sich Heute-Kachel, 7-Tage-Sparkline, Heatmap und Anomalie-Badge automatisch. `refetchInterval` bleibt 15 min.

## Technische Details

- Migration überschreibt beide Funktionen komplett (kein Schema-Add nötig; `rain_past_night_max` als optionale Spalte in `device_events_hourly` per `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).
- Backfill: `SELECT public.aggregate_device_events();` mit temporär geweitetem Zeitfenster in derselben Migration, danach `public.aggregate_device_events_daily();`.
- Chart-Änderung ist rein visuell, keine neuen Libs.

## Erwartetes Ergebnis

- Heute-Kachel zeigt Pumpenminuten / Zyklen / kWh / PV %.
- 7-Tage-Sparkline und Heatmap befüllt (rückwirkend ab heute).
- Regen-Fläche im 48h-Chart auch bei kleinen mm-Werten sichtbar, ohne die Watt/Temp-Skalen zu verzerren.

## Out of scope

- Kein Node-RED-Change (keine neuen Metriken vom Pi nötig).
- Keine Änderung an Ingest-Dedup, Polling oder Retention.
