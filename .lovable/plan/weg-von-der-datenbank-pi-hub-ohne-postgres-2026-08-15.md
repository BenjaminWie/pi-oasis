# Weg von der Datenbank — Pi-Hub ohne Postgres

## Messung zuerst (erledigt)

Ich habe die Datenbank gerade ausgelesen, bevor ich diesen Plan geschrieben habe:

- Letzte geschriebene Telemetrie: **6. August**, seitdem praktisch keine Schreiblast mehr.
- Gesamtgröße: **16,4 MB**, Verbindungen 10/60, Pool 1/200 — die Datenbank langweilt sich.
- Trotzdem laufen weiter ~1,4 Credits/Tag.

**Ergebnis:** Die Kosten kommen **nicht** von Abfragen oder Zeilen, sondern davon, dass die Postgres-Instanz überhaupt läuft. Weiteres Query-Tuning bringt exakt 0. Nur die Instanz komplett abzuschalten senkt die Kosten auf null. Also: raus damit.

## Zielbild

```text
Browser / Alexa / Telegram
        |
   Cloud-Worker (pi-hub.benniwie.com)  <- zustandslos, nur Relay + RAM-Cache
        |  https / WebSocket (Cloudflare Tunnel)
      Pi (Node-RED + Pi-Hub)  <- einzige Quelle der Wahrheit, 48h lokal
```

Kein Postgres, keine Supabase-Tabellen, kein Realtime-Broker. Der Pi hält seine Daten selbst, der Cloud-Teil reicht Anfragen durch und merkt sich den letzten Stand nur flüchtig im Arbeitsspeicher.

## Phase 1 — Pi öffentlich erreichbar ohne Portfreigabe

- Cloudflare-Tunnel-Setup-Skript (`scripts/install-tunnel.sh`) plus Anleitung: der Pi bekommt eine feste `https`-URL, ausgehend, keine Router-Konfiguration.
- Der bestehende lokale SSE-Stream (`/api/live-stream`) und die lokalen Ingest-Endpunkte bleiben unverändert und werden dadurch auch von außen nutzbar.
- Auth an dieser URL: der bereits vorhandene Pi-Token/HMAC-Schutz (`pi-auth.server.ts`) wird auf alle Routen erzwungen, nicht nur lokal.

## Phase 2 — Cloud wird zustandsloses Relay

- Neuer Relay-Layer: Alexa-, Telegram- und Chat-Anfragen fragen den Pi über die Tunnel-URL ab, statt Supabase.
- Letzter bekannter Zustand liegt nur im Worker-Speicher (flüchtig, kostenlos). Ist der Pi offline, antwortet Alexa/Telegram mit „Stand von vor X Minuten".
- `live/publish`, `cloud-bridge/event`, `agent/poll`, `agent/heartbeat`, `agent/realtime` entfallen — der Pi pusht nichts mehr in die Cloud.
- Die Browser-Oberfläche streamt direkt vom Pi per WebSocket/SSE, auch wenn sie über die Cloud-Domain geladen wurde.

## Phase 3 — Login, Alexa und Telegram ohne Datenbank

Das ist der Teil, der heute die Datenbank am Leben hält.

- **Login:** Single-User-Betrieb. Passwort-Hash liegt als Secret, die Sitzung wird als HMAC-signiertes Cookie ausgestellt. Kein Supabase-Auth mehr, Google-Login entfällt.
- **Alexa Account Linking:** OAuth-Codes und Tokens werden selbst-signierte JWTs (Ablauf im Token, kein Speicher). Damit fallen `alexa_oauth_clients`, `alexa_oauth_codes`, `alexa_oauth_token_log` weg — und das dauerhafte Token-Problem gleich mit.
- **Telegram:** Bot-Token und Chat-ID als Secret statt in `profiles`.
- **Geräte-Token:** ein Secret statt `devices.device_token_hash`.

## Phase 4 — SD-Karte schonen

- Lokale JSONL-Historie (48 h) schreibt in einen RAM-Puffer (`/dev/shm`) und wird nur alle 15 Minuten bzw. beim Herunterfahren auf die Karte geschrieben.
- Optionaler Pfad auf USB-Stick/SSD per Umgebungsvariable, dann gar keine Karten-Schreiblast.
- Log-Rotation und `commit=600`-Hinweis im Setup-Dokument.

## Phase 5 — Abschalten

- Alle Supabase-Aufrufe aus dem Code entfernen (Cloud-Routen, `_cloud`-Seiten, `integrations.functions.ts`, `mcp-tools.server.ts`, Favicon-Hook).
- Node-RED-Template auf reinen Lokal-Betrieb umstellen (Cloud-Sinks raus).
- Erst wenn die App ohne Datenbank sauber läuft: Cloud-Backend abschalten. Ab da 0 Credits/Tag für die Datenbank.

## Technische Details

- Betroffen: `src/routes/api/public/**`, `src/routes/_cloud/**`, `src/lib/{cloud-bridge,broadcast,voice-intents,mcp-tools,assistant-brain}.server.ts`, `src/integrations/supabase/*`, `public/nodered-template.json`.
- Neue Bausteine: `src/lib/session.server.ts` (HMAC-Cookie), `src/lib/pi-relay.server.ts` (Cloud → Pi Fetch mit Timeout + RAM-Cache), `src/lib/alexa-jwt.server.ts`.
- Neue Secrets: `PIHUB_SESSION_SECRET`, `PIHUB_PASSWORD_HASH`, `PIHUB_DEVICE_TOKEN`, `PIHUB_PI_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- Der AI-Chat (Lovable AI Gateway) bleibt, greift aber nur noch auf Pi-Tools zu — keine Supabase-Werkzeuge mehr.
- Historie älter als 48 h geht verloren; die 23 Tageszeilen exportiere ich vorher als CSV.

## Reihenfolge

Phase 1 und 4 zuerst (Pi wird eigenständig und schont die Karte), dann 2 und 3, zum Schluss 5. Bis Phase 5 bleibt die alte Cloud-Variante als Rückfallebene bestehen.
