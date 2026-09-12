# Pi Control — radikaler Neuschnitt

Aus dem gewachsenen "Pi Hub" wird **Pi Control**: ein kleines Programm auf dem Pi, das alles kann, und ein Cloud-Teil, der nur noch Befehle weiterleitet.

## Das neue Bild

```text
Alexa / Telegram
      |
Cloud (pi-control)   <- nur Router. DB nur: welches Gerät gehört wem
      |  WebSocket (Pi baut die Verbindung auf, keine Portfreigabe)
Pi (Pi Control)      <- einzige Quelle der Wahrheit
      |  WebSocket
Node-RED             <- meldet seine Endpunkte selbst an
```

Drei Regeln, die alles andere bestimmen:

1. **Node-RED beschreibt sich selbst.** Jeder Flow-Endpunkt meldet Name, Typ (lesen/schalten), Einheit und erlaubte Werte an Pi Control. Nichts wird mehr von Hand eingetragen, keine feste Endpunkt-Liste im Code.
2. **Der Pi hält den Zustand.** Live-Werte im Speicher, 48 h Verlauf lokal. Keine Telemetrie in der Cloud, also auch keine laufenden Datenbankkosten.
3. **Die Cloud speichert nichts außer Gerät + Besitzer.** Ein Befehl kommt an, geht über die offene WebSocket-Verbindung zum Pi, die Antwort geht zurück. Fertig.

## Lokale Oberfläche — drei Tabs

- **Steuerung**: alle entdeckten Endpunkte als Karten. Schalter zum Schalten, Werte als Anzeige. Wird automatisch mehr, wenn du in Node-RED etwas hinzufügst.
- **Feintuning**: pro Endpunkt Anzeigename, Einheit, Grenzwerte, ob Alexa/Telegram ihn sehen und ob er schalten darf. Wird lokal als Datei gespeichert.
- **Debug**: Live-Strom aller ein- und ausgehenden Nachrichten mit Filter, letzte Fehler, Node-RED-Verbindungsstatus, Testschuss auf jeden Endpunkt.

Zugang: eine PIN-Abfrage vor der Oberfläche (die bestehende PIN bleibt), Steuerung und Debug danach als getrennte Tabs.

## Alexa & Telegram

Beide sprechen nur noch mit einer Stelle: "welche Endpunkte gibt es" und "tu das". Die Liste kommt live vom Pi, dadurch kennt Alexa neue Endpunkte sofort, ohne Code-Änderung. Antwortet der Pi nicht, sagt Alexa das ehrlich ("Pi ist offline") statt alte Werte zu erfinden.
Die Alexa-Verknüpfung bleibt token-basiert ohne eigene Tabellen.

## Was wegfällt

Radikal gelöscht: der separate Agent-Ordner, die alte Cloud-Brücke mit Befehls-Warteschlange, Audit-/Analytics-/Nutzungs-Seiten, Plugin-System, MCP-Endpunkt, die Ingest- und Live-Publish-Routen, die Mock-Daten und die Cloud-Telemetrie-Tabellen. Damit fällt der Code auf grob ein Drittel und die Datenbank auf eine Tabelle.

Verlauf, der älter als 48 h ist, ist danach weg — den exportiere ich vorher als CSV.

## Kosten

Nach dem Umbau: keine Telemetrie-Schreibvorgänge, kein Dauer-Polling, keine Realtime-Abos auf Tabellen. Die Datenbank wird nur beim Anmelden und beim Gerät-Registrieren berührt. Erwartung: von ~1,4 Credits/Tag auf nahe null; der Rest sind nur noch AI-Anfragen, die du selbst auslöst.

## Technische Details

- **Neu**: `src/lib/registry.server.ts` (Endpunkt-Register + Konfiguration als JSON auf Platte), `src/routes/api/public/nodered/announce.ts` (Self-Announce + Heartbeat), `src/routes/api/ws.ts` (Pi↔Cloud-Socket, Pi als Client mit Auto-Reconnect), `src/lib/command-bus.server.ts` (Request/Response über den Socket mit Timeout).
- **Cloud-DB**: nur `devices` (id, owner, name, token_hash, last_seen) mit RLS auf `auth.uid()`. Alle übrigen Tabellen werden am Ende gelöscht.
- **Entfernt**: `agent/`, `src/lib/{cloud-bridge,broadcast,mcp-tools,plugins-store,plugin-runner,agent-api,ai-planner,mock-data}.*`, `src/lib/{cloud,cloud-pairing,alerts,usage,mcp-tokens,plugins,integrations}.functions.ts`, `src/routes/api/public/{agent,cloud-bridge,ingest,live,hooks,mcp.ts}`, `src/routes/_cloud/{devices*,plugins,connections.usage,connections.mcp}`.
- **Umbenennung**: Paketname, Titel, Manifest, Service-Worker-Cache, systemd-/PM2-Namen und Doku auf `pi-control`; alte Routen bleiben per Weiterleitung erreichbar.
- **Node-RED-Template** wird neu geschrieben: ein Announce-Node, ein WebSocket-Ausgang für Live-Werte, ein Eingang für Befehle, ein Debug-Kanal. Keine doppelten Cloud-Senken mehr.

## Reihenfolge

1. Register + Self-Announce + lokale Steuerungs-/Feintuning-/Debug-Tabs (danach ist der Pi allein voll nutzbar)
2. Cloud auf reines Routen umstellen, Alexa/Telegram auf das Register umhängen
3. Alte Teile löschen, Umbenennung, Tabellen abräumen
