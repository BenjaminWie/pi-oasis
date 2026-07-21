## Ziel

Alexa Skill + Telegram teilen dieselbe Intent-Route, Account Linking läuft über echten OAuth2-Server, Node-RED bekommt System-Stats-Streaming — **ohne** die Zero-Wake-Architektur zu brechen (Ziel bleibt < 0.5 Credits/Tag).

## Zero-Wake-Leitplanken (nicht verhandelbar)

- **Kein neuer periodischer DB-INSERT.** System-Stats gehen **nur** über Realtime-Broadcast, nie in `device_events`.
- **Kein 30-s Long-Poll auf Postgres.** `agent_commands`-Delivery läuft über Realtime-Wake-Ups; Postgres wird nur bei tatsächlichem Kommando geweckt (Alexa/Telegram-Klick → ~10-30/Tag statt 2880/Tag).
- **Read-Only Intents (Status) schreiben keine Audit-Row.** Nur mutierende Intents (`pump.on`, `mqtt.publish`, `container.action`) landen in `mcp_audit` / `agent_commands`.

## 1) OAuth2-Server für Alexa Account Linking

Neue TSS-Routes unter `src/routes/api/public/oauth/`:

- `GET /api/public/oauth/authorize` — prüft Supabase-Session (`supabase.auth.getUser()`); ohne Session → 302 nach `/auth?next=<encoded /authorize URL>`. Mit Session: rendert Consent-Seite ("Alexa mit Pi-Hub verbinden — Gerät X, Scope `control`"). Auf **Zustimmen** → 302 auf Alexa `redirect_uri` mit einmaligem `code` (10 min, HMAC-signed, enthält `user_id`, `device_id`, `scope`, `client_id`, `redirect_uri`).
- `POST /api/public/oauth/token` — Alexa tauscht `code` (oder `refresh_token`) gegen Bearer. Wir minten ein MCP-Token (bestehende `mcp_tokens`-Tabelle, `scope=control`, 1y TTL, an Gerät gebunden), geben es als `access_token` zurück (`token_type=bearer`, `expires_in`, `refresh_token`).

**DB Migration** (kleine, einmalige Änderung — keine periodischen Writes):
- `alexa_oauth_clients(id, user_id, device_id, client_id text unique, client_secret_hash text, redirect_uris text[], created_at)` — RLS: `auth.uid() = user_id`, GRANTs für authenticated + service_role.
- `alexa_oauth_codes(code_hash text pk, client_id text, user_id uuid, device_id uuid, redirect_uri text, scope text, expires_at timestamptz)` — service_role only, 10-min TTL, single-use (row löschen bei Redemption).

## 2) `/connect/alexa` UI komplett neu

Step-by-Step mit exakten Copy-Rows und "muss identisch sein"-Hinweisen:

1. **Custom Skill anlegen** — Sprache DE, Modell Custom.
2. **Endpoint** (HTTPS): `https://pi-hub.benniwie.com/api/public/voice/alexa` — Zertifikat "trusted CA".
3. **Invocation Name**: `pi hub` — muss exakt so im Skill Builder stehen (JSON und Console).
4. **Intent Schema** einfügen (Copy-Button, aktualisiertes JSON) → Build Model.
5. **Account Linking → Auth Code Grant**:
   - Authorization URI: `https://pi-hub.benniwie.com/api/public/oauth/authorize`
   - Access Token URI: `https://pi-hub.benniwie.com/api/public/oauth/token`
   - Client ID / Client Secret (aus DB, "Neu generieren" Button)
   - Client Authentication Scheme: **HTTP Basic**
   - Scope: `control`
6. **In Alexa App verknüpfen** — nur nach Account Linking erscheint `accessToken` im Request.
7. **Testen** — Beispiel-Utterances.

Doku-Link korrigiert auf Amazons Auth-Code-Grant-Seite.

## 3) Gemeinsame Intent-Route für Alexa + Telegram

Neuer Helper `src/lib/voice-intents.server.ts` mit `runIntent({ userId, deviceId, intent, slots, source })`:

| Intent | mutierend? | Backend |
| --- | --- | --- |
| `pump.on(minutes?)` | ja | `agent_commands` `plugin_manual` (runner=nodered) + `mcp_audit` |
| `pump.off()` | ja | `agent_commands` + `mcp_audit` |
| `pump.status()` | **nein** | Read `device_state_latest`; **kein** Audit-Row |
| `system.status()` | **nein** | Read `device_state_latest`; **kein** Audit-Row |
| `mqtt.publish(topic,payload)` | ja | `cmnd/*`-Whitelist; `agent_commands` + `mcp_audit` |
| `energy.price_now()` | nein | Read `strategy_profiles` (aktuelles Tibber-Feld); kein Audit |
| `laundry.state(app)` | nein | Read `appliance_profiles` + `device_state_latest`; kein Audit |

Alexa (`/voice/alexa`) und Telegram (`/telegram/webhook`) rufen nur noch `runIntent(...)`. Antworten identisch, Audit einheitlich, keine Divergenz mehr.

## 4) Node-RED Command-Delivery: Realtime statt Long-Poll

**Aktuell:** `/api/public/agent/poll` läuft 25 s in einer `while`-Schleife und macht alle 2 s ein SELECT auf `agent_commands` → hält Postgres wach.

**Neu:**
1. Nach jedem `INSERT INTO agent_commands` (aus `runIntent`, MCP-Server, UI-Buttons) sofort HTTP-POST an Supabase Realtime Broadcast: `topic=commands:<device_id>`, `event=wake`. **Keine DB-Query** in Node-RED nötig.
2. Node-RED-Template bekommt einen `websocket in`-Node, der zu Supabase Realtime verbindet und `commands:<device_id>` abonniert. Bei `wake` triggert er **einen** GET auf `/api/public/agent/poll?runner=nodered` — der neu geschriebene Handler ist jetzt **nicht mehr long-polling**, sondern führt eine einzige SELECT-Query aus und antwortet 200 (mit Kommando) oder 204 (leer).
3. **Safety-Net-Fallback**: alle 15 min ein Standard-HTTP-Poll (falls WebSocket abriss). Das sind 96 Wakeups/Tag statt 2880.

**Aufwand:** ~15 Zeilen Änderung in `poll.ts` (Loop raus), ~1 Zeile in `/agent/heartbeat.ts` (nach INSERT broadcasten), ein neuer Realtime-Node im Template.

## 5) Node-RED System-Stats Streaming — **nur** über Live-Broadcast

`/api/public/live/publish` Schema wird erweitert um optionale Felder: `cpu_pct`, `mem_pct`, `temp_c`, `swap_pct`, `disk_pct`, `mqtt_broker_status`. Rate-Limit bleibt bei 500 ms/Gerät.

Node-RED-Template:
- Tab **Pi System Stats** (5-Min-Timer): schickt Payload **nur** an `/api/public/live/publish` — **nicht** an `/cloud-bridge/event`.
- Tab **Hardware-Control**: Pump-State-Änderungen bleiben auf `/cloud-bridge/event` (das sind ~5-10 Events/Tag, kein Problem).
- Tab **MQTT Broker Watch**: `mqtt_broker_status` Änderungen → Live-Broadcast; nur bei `critical` zusätzlich DB (damit historische Alarme sichtbar bleiben).

**Cloud-UI** (`/pump` und `/devices/:id`): subscribed bereits `live:<device_id>` — erweitert um Anzeige der System-Stats-Felder (kleine Metrik-Zeile: CPU/Temp/Swap). Keine neue Query, keine neue Subscription.

## 6) Doku-Updates

- `docs/mcp.md` — Alexa-Abschnitt komplett neu (Auth-Code-Grant statt Bearer-Workaround).
- Neue `docs/alexa-setup.md` — 1:1 Skill-Console-Screenshots-Ablauf.
- `docs/nodered-integration.md` — Abschnitte "Realtime Command Wake-Up" und "System-Stats via Live-Broadcast" mit expliziter "was NIE in die DB darf" Liste.

## Verifikation

- `curl /oauth/authorize` ohne Session → 302 nach `/auth?next=...`
- `curl -X POST /oauth/token -d grant_type=authorization_code&code=...` → gültiges MCP-Bearer
- Alexa Simulator nach Account Linking: `session.user.accessToken` gesetzt
- "Alexa, sage pi hub Pumpe an für 2 Minuten" → 1 INSERT `agent_commands`, Broadcast auf `commands:<id>`, Node-RED empfängt Wake, holt Kommando, MQTT `cmnd/zisterne/POWER ON`, Auto-OFF nach 2 min
- Telegram `/pump on 2` → identisches Verhalten via `runIntent`
- 24-h-Messung nach Deploy: `SELECT count(*) FROM agent_commands WHERE created_at > now() - '1d'` sollte < 50 bleiben; `pg_stat_activity` zeigt Idle-Phasen > 20 h/Tag
- System-Stats sichtbar in UI innerhalb ≤ 1 s nach Node-RED-Tick; **keine** neuen Zeilen in `device_events` mit `component='system_hardware'`

## Nicht enthalten (bewusst)

- Alexa-Skill-Zertifizierung (Cert-Chain, Multi-Tenant Consent) — Personal Skill Setup bleibt.
- Kein Refactor der Eco-Logik oder Safety-Caps.
- Keine Persistierung von System-Stats-Historie — bewusster Trade-off gegen Cost.
