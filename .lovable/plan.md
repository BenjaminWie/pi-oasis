## Was du eigentlich willst

1. **Node-RED ↔ Pi-Hub sauber dokumentieren** — auf dem lokalen Pi sichtbar, mit allen URLs/Tokens, die dein Flow (`CLOUD_BRIDGE_URL`, `CLOUD_STRATEGY_URL`, `CLOUD_DEVICE_TOKEN`, `LOCAL_API_URL`, `PI_INGEST_TOKEN`) braucht — kopierbar wie bei Telegram/Alexa.
2. **Connect-Karten reparieren** — MCP/Telegram/Alexa sind aktuell nicht klickbar, du kommst nicht an URL/Token.
3. **Reasoning-Use-Case** sauber positionieren: „Alexa, schalt die Zisterne an" und „Ist meine Wäsche fertig?" (Tibber-Live + AI), nicht nur Pumpe AN/AUS.

---

## Plan

### A) Connect-Hub reparieren (`/cloud/connections`)

- Ursache: Die Karten sind als ganze `<Link>`-Blöcke gebaut, aber das `_cloud`-Layout hat `pb-28` + ein `fixed bottom-0` Nav, das auf manchen Viewports die unteren Cards überdeckt — Tap-Region geht ins Nav. Fix:
  - `_cloud.tsx`: `pb-28` → `pb-32`, `pointer-events-none` auf den unsichtbaren Bereich rund ums Nav vermeiden, Nav bekommt klares `z-40`, Outlet-Container `relative z-0`.
  - Connect-Cards: Karten bleiben `<Link>`, aber mit `block w-full` + `relative z-10` und Hit-Area-Test auf Mobile-Viewport per Playwright.
- Nach dem Fix: Jede Karte führt zu einer eigenen Detailseite mit **Endpoint, Token-Erzeugung, Beispiel-Snippets, Doku-Link**.

### B) Connect-Detailseiten vereinheitlichen

Einheitliches Muster (wie Alexa-Page schon hat): Schritt-für-Schritt, jede Zeile mit Copy-Button, Doku-Link, Live-Status der Verbindung.

- **MCP (`/connections/mcp`)** — bereits da, aber:
  - Oben prominent ein „Quickstart"-Block: Endpoint-URL + Bearer-Token-Snippet für ChatGPT/Gemini/Claude/Open WebUI, jeweils 1 Copy-Klick.
  - Verlinkung „Was kann ich fragen?" → Beispiele inkl. „Ist meine Wäsche fertig?" (siehe E).
- **Telegram** — bestehender Flow bleibt, plus Link auf „Sprachbefehle & Beispiele".
- **Alexa** — bestehende Step-by-Step bleibt, ergänzt um zwei Intents (`LaundryDoneIntent`, `EnergyAskIntent`) für Reasoning-Fragen.

### C) Node-RED Integration auf dem Pi sichtbar machen

Neue Pi-lokale Route `/integrations` (im Bottom-Nav klein „NR" Icon, nur wenn nicht-slim), zeigt alles, was dein Flow braucht — **alle Werte einmalig auf einer Seite kopierbar**:

```
CLOUD_BRIDGE_URL    https://pi-hub.benniwie.com/api/public/cloud-bridge/event
CLOUD_STRATEGY_URL  https://pi-hub.benniwie.com/api/public/cloud-bridge/strategy
CLOUD_DEVICE_TOKEN  <Button "Token holen" → öffnet /cloud/devices Pairing-Flow>
LOCAL_API_URL       http://<pi-ip-auto-detected>:3000/api/public/ingest/event
PI_INGEST_TOKEN     <generieren + anzeigen, hash-gespeichert>
```

Zusätzlich:
- Ein-Klick „Node-RED Flow-Template JSON herunterladen" (deine geposteten Tabs 1+ Cloud-Bridge als sauberer Subflow, vorausgefüllt mit den richtigen URLs).
- Health-Anzeige: letzte Cloud-Push-Zeit, letzte Strategy-Poll-Zeit aus `device_events`.
- Inline-Doku-Block (kondensiert aus `docs/nodered-integration.md`) mit den drei Punkten Direct-Ingest / Strategy-Poll / Fallback-zu-Local.

In der Cloud-Variante (`/cloud/devices/$id`) bekommt der „Strategie"-Tab denselben Copy-Block für die Werte, damit du sie aus der Ferne einsehen kannst.

### D) Doku-File erweitern

`docs/nodered-integration.md` erweitern um:
- Wer triggert wen (Sequence-Diagramm in ASCII).
- `mqtt_publish` aus der Cloud → Node-RED via `mqtt-in` auf Topic `pi-hub/strategy/+`, damit Cloud auch direkt steuern kann (zusätzlich zum Polling).
- Failure-Modes: Cloud-Down → Local-Fallback (du hast das schon), Tibber-Down → letzte bekannte Preise, DWD-Down → konservativer Modus.

### E) Reasoning-Use-Case: „Ist meine Wäsche fertig?"

Erweiterung des MCP-Servers (`src/routes/api/public/mcp.ts` + `src/lib/mcp-tools.server.ts`):

Neue Tools, die rein read-only sind und keinen Pi-Roundtrip brauchen (Daten liegen schon in `device_events`):

- `get_power_history(window_minutes)` → Zeitreihe der `metrics.watts` aus `device_events` (Tibber-Pulse-Live wird ja schon gepusht via Node-RED Cloud-Bridge).
- `get_tibber_price_now()` → aktueller Preis (aus letztem Tibber-Event).
- `infer_appliance_state(appliance)` → Server nimmt die letzten 30 min Watt-Reihe + Tibber-Daten und gibt strukturiert zurück: `{ running: bool, since_min: number, est_finish_min: number|null, confidence }`. Heuristik: Waschmaschine = ≥150 W über ≥10 min, „fertig" wenn Watt < 5 W für ≥3 min nach aktiver Phase. Schwellwerte konfigurierbar pro `appliance_profiles`-Tabelle (neu, klein, RLS scoped).

Damit funktioniert in jedem MCP-Client (ChatGPT/Gemini/Claude) **und** in Alexa (über `LaundryDoneIntent` → MCP-Tool → strukturierte Antwort → TTS) **und** in Telegram die Frage „ist meine Wäsche fertig?".

Auf der MCP-Seite ergänzen wir einen „Beispiel-Prompts"-Block mit genau diesen Fragen, damit klar ist, was geht.

### F) Verifizieren

- Playwright-Skript: `/auth` Login, `/cloud/connections` öffnen, alle drei Karten anklicken, jeweils Screenshot dass Detailseite kommt.
- Pi-lokal: `/integrations` aufrufen, Copy-Buttons existieren, Health-Werte rendern.
- MCP: JSON-RPC `tools/list` enthält `infer_appliance_state`; ein Aufruf mit Demo-Daten gibt sinnvolle Response.

---

## Technisches (kurz)

- Neue Tabelle `appliance_profiles` (`user_id`, `device_id`, `name`, `min_watts`, `min_runtime_min`, `idle_watts`, `idle_after_min`) + RLS + GRANTs.
- Neue Server-Route `/_authenticated/integrations.tsx` (Pi-UI) + dort `host-info.functions.ts` erweitern, damit die LAN-IP automatisch angezeigt wird.
- `mcp-tools.server.ts`: zwei neue Tools registrieren; `infer_appliance_state` ist pure Funktion über DB-Reads → kein Pi-Roundtrip → keine Latenz.
- `_cloud.tsx` Layout-Fix + Connect-Cards `z-10`, Bottom-Nav `z-40`.
- Node-RED Flow-Template bauen wir als statisches JSON unter `public/nodered-template.json` (Subflow „pi-hub cloud bridge" mit eingesetzten env-Defaults), Download-Link in `/integrations`.

Kein Eingriff in Pump-Logik, kein Eingriff in Pairing-Flow.
