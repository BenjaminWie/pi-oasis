## Architektur

```
┌──────────┐   HTTPS poll    ┌──────────────────┐   webhook   ┌──────────┐
│  Pi      │ ───────────────►│  Lovable Cloud   │◄────────────│ Telegram │
│  Agent   │◄─── commands ───│  (Verwaltung)    │────sendMsg─►│   Bot    │
│ (Node)   │   POST results  │  Cloud DB + API  │             │ pro User │
└────┬─────┘                 └──────────────────┘             └──────────┘
     │ docker.sock / /proc / lokaler MQTT
```

- **Pi-UI bleibt unverändert** (Live-Dashboard, Terminal, MQTT-Inspector — nur LAN).
- **Cloud-UI** = Verwaltung: Login, Geräte registrieren, Bot-Token einhängen, Audit-Log.
- **Pi-Agent** = neuer kleiner Node-Prozess (`pi-agent`) im selben Repo, läuft parallel zur Dashboard-UI oder allein headless. Spricht nur Outbound HTTPS zur Cloud — keine offenen Ports nötig.
- **Long-Polling**: Agent macht `GET /api/agent/poll?wait=25s`. Cloud hält Request offen bis Command vorliegt oder Timeout, antwortet, Agent führt aus und `POST /api/agent/result`. Status-Snapshots werden periodisch (alle 30 s) via `POST /api/agent/heartbeat` geschickt.

## Cloud-Anwendung (Lovable Cloud aktivieren)

**Datenbank** (`public` Schema, mit GRANTs + RLS):
- `profiles` — verknüpft mit `auth.users`, hält `telegram_bot_token` (verschlüsselt via pgsodium), `telegram_chat_id`, `linked_at`.
- `devices` — `id`, `user_id`, `name`, `pairing_code` (8-stellig, einmalig), `device_token_hash`, `last_seen_at`, `last_snapshot jsonb`.
- `agent_commands` — `id`, `device_id`, `kind` (`status` / `container_action` / `mqtt_publish` / `mqtt_subscribe`), `payload jsonb`, `status` (`pending`/`delivered`/`done`/`failed`), `result jsonb`, Timestamps. RLS: nur Owner sieht eigene.
- `telegram_audit` — wer hat wann welchen Befehl per Bot ausgelöst.

**Auth**: Email/Password + Google (Lovable-Defaults). Vor jeder Aktion `auth.uid()`-Check.

**Server-Routes** (Pi spricht hier rein, kein User-Session — Auth via Device-Bearer):
- `POST /api/public/agent/register` — tauscht `pairing_code` gegen Device-Token (zeigt Cloud-UI nach „+ Gerät anlegen“ als 8-stelligen Code an, 10 Min gültig).
- `GET  /api/public/agent/poll` — Long-Poll, Header `Authorization: Bearer <device-token>`. Liefert nächsten `pending` Command oder 204 nach 25 s.
- `POST /api/public/agent/result` — Ergebnis posten, setzt Command auf `done`/`failed`, triggert ggf. Telegram-Antwort.
- `POST /api/public/agent/heartbeat` — `{cpu, ram, temp, disk, containers:[{name,status}], mqtt_brokers:[…]}` → schreibt in `devices.last_snapshot`.
- `POST /api/public/telegram/webhook/:userId` — Telegram-Webhook pro User-Bot. Verifiziert via `X-Telegram-Bot-Api-Secret-Token` (Secret = HMAC(user_id)). Mappt `chat_id` ↔ `profiles`.

**Server-Functions** (User-UI):
- `createDevice` → erzeugt Pairing-Code.
- `listDevices` / `getDeviceSnapshot`.
- `linkTelegramBot({token})` → ruft `setWebhook` bei Telegram auf, speichert Token verschlüsselt.
- `revokeDevice` / `unlinkBot`.

**Telegram-Bot-Logik** (in `/api/public/telegram/webhook/:userId`):
- `/start` → fordert `/link <code>` an (Code aus Cloud-UI „Telegram verbinden“).
- `/status [device]` → enqueued `status` Command (oder liefert letzten Snapshot wenn frisch <60 s).
- `/containers` → Liste aus letztem Snapshot, Inline-Buttons (Start/Stop/Restart) → enqueued `container_action`.
- `/mqtt pub <topic> <payload>` → enqueued `mqtt_publish`.
- `/mqtt sub <topic>` → enqueued `mqtt_subscribe` (Agent streamt Treffer 5 Min lang via `result`-Posts, Cloud schickt als Nachrichten).
- `/devices` → Übersicht mit Heartbeat-Alter.

## Pi-Agent (`pi-agent` CLI im selben Repo, neuer Pfad `agent/`)

Ein kleiner Node-Prozess, **vollständig getrennt vom Dashboard** — kein React, nur `node:http` + `dockerode` + `mqtt`. <15 MB RSS.

**Befehle**:
```
pi-agent register             # interaktiv: Cloud-URL + Pairing-Code → speichert ~/.pi-agent/config.json
pi-agent run                  # Daemon: long-poll loop + heartbeat (systemd-tauglich)
pi-agent status               # one-shot lokaler Snapshot (kein Cloud-Call) — pipe-bar für gemini-cli
pi-agent unlink               # Token rotieren / löschen
```

**Config**: `~/.pi-agent/config.json` = `{cloudUrl, deviceToken, heartbeatSec, mqttBrokerHints}`.
**Systemd-Installer**: `scripts/install-agent-systemd.sh` — separate Unit `pi-agent.service`, `MemoryMax=64M`, `Restart=always`.

**Command-Handler**:
- `status` → liest `/proc/stat`, `/proc/meminfo`, `vcgencmd`, `dockerode.listContainers`.
- `container_action` → `dockerode.getContainer(id)[start|stop|restart]()`.
- `mqtt_publish` / `mqtt_subscribe` → verbindet sich kurzzeitig zum lokalen Broker (Auto-Detection wie schon in der Dashboard-Logik).

**Security am Agent**:
- Nur HTTPS, Token im Header.
- Whitelist erlaubter Command-Kinds in Code — alles andere wird ignoriert.
- Keine Shell-Ausführung von außen (Terminal bleibt explizit LAN-only, nicht über Cloud erreichbar).

## Cloud-UI (Verwaltung, mobile-first im selben Industrial-Cyberpunk-Stil)

Neue Routen unter `_authenticated/`:
- `/devices` — Liste, Status-Dot (Heartbeat <2 Min = grün), letzte Stats inline.
- `/devices/new` — Button erzeugt Pairing-Code, zeigt 1× groß + Copy + Curl-Hinweis: `pi-agent register --code XXXX --url https://<cloud>`.
- `/devices/$id` — Snapshot-Detail, Command-Verlauf, „Trennen".
- `/telegram` — Anleitung BotFather → Token-Feld → Test-Button. Status: Webhook registriert ja/nein, Chat verknüpft.
- `/audit` — Telegram-Audit-Log.

## Security-Checks im Cloud-Relay (das ist der Schutzschild, den du willst)

- **Zod-Validierung** aller Bodies, strikte Allowlist für `container_action` (`start|stop|restart`, kein `exec`).
- **Rate-Limit** pro Device-Token (z. B. 60 Commands/Min) — in-memory Map mit TTL im Worker-Kontext.
- **Telegram-Auth zweistufig**: nur verifizierter Webhook-Header **und** `chat_id` muss in `profiles` stehen (nach `/link`).
- **Token-Rotation**: Device-Token = `random(32)`, gespeichert als sha256-Hash. Re-pair invalidiert alten Token.
- **Audit**: jeder Bot-Befehl wird vor Enqueue in `telegram_audit` geloggt.
- **Bot-Token** in DB mit Lovable Cloud Secret-Verschlüsselung (pgsodium) — nie roh an Client.

## Setup-Flow (so wie du's beschrieben hast)

1. In Cloud-UI registrieren, Gerät anlegen → Pairing-Code.
2. Am Pi: `git clone …; ./scripts/install.sh; pi-agent register --code 12345678 --url https://<deine-cloud>.lovable.app; ./scripts/install-agent-systemd.sh`.
3. In Cloud-UI „Telegram verbinden" → Token aus BotFather einfügen, Webhook wird automatisch gesetzt.
4. In Telegram: `/start` → `/link <code-aus-cloud>` → fertig.
5. `/status`, `/containers`, `/mqtt pub home/test hello` → Cloud enqueued, Pi pollt, antwortet, Bot schickt Ergebnis.

## Phasen

1. **Cloud-DB-Schema + Auth-UI** (Lovable Cloud aktivieren, Tabellen, Login, `/devices` CRUD).
2. **Agent-Endpoints** (`register`/`poll`/`result`/`heartbeat`) + Mock-Agent im Preview.
3. **Pi-Agent** (`agent/` Verzeichnis, CLI, systemd-Installer).
4. **Telegram-Integration** (Webhook-Route, `/link`, `/status`, `/containers`).
5. **MQTT-Commands über Bot** + Audit-Log + Rate-Limit.

## Offene Punkte

- Lovable Cloud aktiviere ich im ersten Schritt (für DB, Auth, Secrets) — ok?
- Telegram-Bot-Token speichere ich verschlüsselt in der DB pro User (nicht als globalen Lovable-Secret, da 1 Bot/User). Passt?
- Cloud-URL als Default für `pi-agent register`: nutze ich `project--<id>.lovable.app` (stabil).

Bereit, mit Phase 1 zu starten sobald du den Plan freigibst.