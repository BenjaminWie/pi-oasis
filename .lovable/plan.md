
## Ziel
Die Cloud-Seite ist die **Kontroll- und Beobachtungsschicht** für den Pi. Drei klare Bereiche statt zerfaserter Tabs:

```text
[ Geräte ]   [ Pumpe ]   [ Connect ]
```

Audit, Terminal in der Cloud, und der generische „Plugins"-Tab fliegen raus. Der Use-Case ist heute Pumpe + Tibber + Wetter — also bauen wir genau das, statt eine abstrakte Plugin-Hülle.

## Was geändert wird

### 1. Bottom-Nav reduziert auf 3 Tabs
- **Geräte** (bleibt)
- **Pumpe** (neu, ersetzt Plugins)
- **Connect** (bleibt, wird klickbar gefixt)
- ~~Audit~~ entfernt (Geräte-Detail zeigt relevante Events; MCP-Audit bleibt im Hintergrund persistiert)

### 2. Connect-Seite klickbar + Alexa nach Telegram-Vorbild
- Bug: Die `<Link to={s.href}>`-Targets sind als String hartcodiert, aber TanStack-Router will typsichere Routen — Klicks landen im Nichts. Auf `<Link to="/connections/telegram">` etc. mit korrektem Routing umstellen und Hover/Active-States anziehen.
- **Telegram-Karte** bleibt im jetzigen Flow (funktioniert).
- **Alexa-Karte** im gleichen Stil wie Telegram aufbauen:
  - Schritt-für-Schritt-Setup mit Copy-Buttons (Endpoint, Invocation Name, JSON-Intent-Schema zum Reinpasten)
  - Auto-generierter MCP-Token mit `control`-Scope direkt aus der UI (1-Click „Token erstellen + kopieren")
  - Link zur Alexa Skill Builder Doku + Account-Linking-Doku
  - Status-Anzeige: „zuletzt aufgerufen" (aus `mcp_audit` für diesen Token)
- **MCP-Karte** bekommt analog dazu klare Copy-Blöcke (Endpoint, Token-Generierung, Modell-Hinweise für ChatGPT/Gemini/Claude).

### 3. Pumpe-Tab (ersetzt Plugins)
Eigene Route `/pump` mit den heute relevanten Use-Cases gebündelt:
- **Status-Kachel**: aktueller Watt-Wert, On/Off, letzter Lauf, heute schon gelaufen X min
- **Manuelle Steuerung**: An (5/10/30 min), Aus, Eco-Pause-Toggle
- **Strategie-Form**: PV-Min-Watt, Tibber-Cap (ct/kWh), Heizfenster, max. Minuten/Tag, Regen-Veto-mm → schreibt in `strategy_profiles` (existiert schon)
- **Letzte Entscheidungen** (Timeline, gefiltert auf `component=pump` aus `device_events`): „11:42 — Started · PV 612W, Tibber 18ct" / „13:10 — Skipped · Regen vorhergesagt"
- **Watt-Verlauf** (Recharts, letzte 24h, aus `device_events_hourly`)
- Gerät wird oben per Dropdown gewählt (für später >1 Pi)

Das alte `smart_pump`-Plugin-Backend bleibt unangetastet — wir bauen nur die UI um diesen konkreten Use-Case herum.

### 4. Geräte-Detailseite zeigt echte Live-Daten
Aktuelles Problem: „Restart Pi"-Button etc. machen nichts sichtbar, Terminal-Block ist Lärm.
- **Terminal-Sektion komplett entfernen** (Cloud ist kein SSH-Ersatz).
- Snapshot-Kacheln (CPU/RAM/Temp/Disk) bleiben — werden aus dem regelmäßigen Heartbeat live nachgezogen (existiert bereits).
- **Container-Liste** bleibt mit Start/Stop/Restart; jeder Aktion folgt automatisch ein `status`-Refetch, damit das Ergebnis sichtbar wird.
- **„Restart Pi"-Button**: tatsächlich verdrahten gegen vorhandenes `enqueueCommand({kind:"system_reboot"})` (Server-fn-Schema dafür ergänzen falls fehlend) + Toast „Befehl gesendet · wird in ~30s offline gehen".
- **Live-Event-Stream** (kleines Fenster, letzte 20 Events aus `device_events`) ersetzt das Terminal — zeigt was Node-RED / Plugins gerade tun.
- Plugin-Sektion auf Detailseite raus (existiert dediziert im Pumpe-Tab).

### 5. Lokaler Pi → Cloud-Spiegelung der Live-Daten
- Lokales Dashboard sammelt heute Containerliste + System-Snapshot. Heartbeat-Push (existiert) wird so erweitert, dass er bei jedem Tick auch die **Docker-Container-Liste** und den **Plugin-Runner-Status** in `devices.last_snapshot` schreibt (passiert teilweise schon — wir verifizieren und füllen Lücken).
- Kein zusätzlicher Polling-Loop nötig, kein SD-Schreiben — nur den existierenden Heartbeat-Payload erweitern.

### 6. Audit-Tab + Route entfernen
- `/_cloud/audit.tsx` Route löschen, aus Bottom-Nav raus.
- `mcp_audit`-Tabelle bleibt (wird für „zuletzt benutzt"-Anzeige in Connect-Cards genutzt).

## Technische Notizen
- Nav-Liste in `src/routes/_cloud.tsx`: 4 → 3 Tabs, `audit` raus, `plugins` → `pump`.
- `src/routes/_cloud/connections.tsx`: `<Link>`-Komponenten richtig typisieren, `active:scale-[0.98]` + sichtbares `hover`.
- Neue Route `src/routes/_cloud/pump.tsx` (ersetzt `_cloud/plugins.tsx` als Top-Level-Tab; Plugin-Detail-Route darf intern bleiben, ist aber nicht mehr in der Nav).
- `src/routes/_cloud/devices.$id.tsx`: Terminal-Block + Plugin-Block raus, Live-Event-Stream rein, Reboot-Button verdrahten.
- `src/routes/_cloud/connections.alexa.tsx`: ausbauen analog `connections.telegram.tsx`, mit MCP-Token-Generator (existiert in `mcp-tokens.functions.ts`).
- Server-fns für Pumpe lesen `device_events` (component=pump) + `device_events_hourly` + `strategy_profiles` — existieren oder lassen sich aus vorhandenen Bausteinen kurz zusammensetzen.
- Reboot-Command: `commandSchema` in `src/lib/cloud.functions.ts` um `system_reboot` erweitern; Pi-Agent-Handler (`cloud-bridge.server.ts`) führt `sudo reboot` aus (bereits vorhandenes Pattern für Terminal-Cmd wiederverwenden, mit erlauben-Liste).

## Out of scope
- Mehrere Pumpen / dynamische Geräte-Typ-UI — kommt erst, wenn ein zweiter Use-Case real ansteht.
- Audit-Replacement-UI — wenn später nötig, kommt sie als Sub-Tab unter Geräte.
- Plugin-Detailseiten (bleiben technisch, ohne Nav-Eintrag).
