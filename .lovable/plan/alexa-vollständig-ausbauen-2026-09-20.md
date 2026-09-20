# Alexa vollständig ausbauen

Ziel: Alexa kann am Ende wirklich sagen „Alexa, sage Pi Control: Pumpe an" — mit einer sauberen Zustimmungs-Seite, funktionierender Verknüpfung und Sprachbefehlen, die bis zur Pumpe durchgehen.

## Was heute schon da ist

- Zustimmungs-Seite, Code- und Token-Austausch sowie der Skill-Endpunkt existieren.
- Befehle laufen über den Endpunkt-Katalog, den Node-RED selbst anmeldet.
- Nichts wird gespeichert: Codes und Tokens sind signiert.

## Was fehlt und gebaut wird

1. **Zustimmungs-Seite fertig machen**
   - Wird auf dem Server gerendert, damit sie in der Alexa-App sofort sichtbar ist (heute kurz leer).
   - Prüft Skill-Kennung und Rücksprung-Adresse bevor nach dem Geheimwort gefragt wird; sonst klare deutsche Meldung statt technischem Fehler.
   - Zeigt an, welcher Pi verknüpft wird und ob er gerade erreichbar ist.
   - Nach Zustimmung ist der Code nur 60 Sekunden gültig und nur für genau diese Anfrage.

2. **Verknüpfung nachvollziehbar machen**
   - Jeder Schritt (Zustimmung, Code eingelöst, Token erneuert, Fehler) landet im Debug-Protokoll im Kanal „Alexa", mit Grund bei Ablehnung.

3. **Echte Skill-Befehle**
   - Der Skill akzeptiert nur die eigene Skill-Kennung und keine veralteten Anfragen.
   - Pumpe an/aus, Bewässern mit Minuten, Nachtruhe, Strategie, Regen, Überschuss, Strompreis, Status, Endpunkt-Liste und freie Fragen; Rückfrage, wenn Minuten fehlen.
   - Antwortet ehrlich „Der Pi antwortet nicht", wenn der Befehl nicht ankam, statt Erfolg zu melden.

4. **Sprachmodell zum Import**
   - Pi Control erzeugt das deutsche Alexa-Sprachmodell aus den tatsächlich angemeldeten Endpunkten und stellt es zum Herunterladen bereit — in der Alexa Console nur noch einfügen und speichern.

5. **Anleitungs-Seite ausbauen (/connections/alexa)**
   - Checkliste mit Ampeln: Geheimnisse gesetzt, Pi erreichbar, Skill-Kennung hinterlegt.
   - Alle Werte zum Kopieren, Button „Sprachmodell herunterladen".
   - Button „Testbefehl senden": schickt einen echten Sprachbefehl durch den Skill-Weg und zeigt die Antwort — ohne Alexa-Gerät.

## Benötigte Geheimnisse

Vorhanden bleiben: Client-ID, Client-Secret, Link-Geheimwort, Signatur-Schlüssel. Neu dazu: die Skill-Kennung aus der Alexa Console (damit fremde Skills den Endpunkt nicht nutzen können). Fehlende Werte lege ich beim Umsetzen über das sichere Formular an.

## Technische Details

- `src/routes/api/public/oauth/authorize.tsx`: SSR statt `ssr: false`; Vorvalidierung von `response_type=code`, `client_id`, `redirect_uri` in einem Loader über eine öffentliche Server-Funktion; Fehlerzustände als eigene Ansicht.
- `authorize-post.ts`: Code-TTL 10 min → 60 s, zusätzliche `nonce` im Payload, Debug-Logging via `debugLog(..., "alexa")`.
- `token.ts`: Logging von `authorization_code`/`refresh_token`-Ergebnissen, unveränderte Scope-Normalisierung.
- `src/routes/api/public/voice/alexa.ts`: `PIHUB_ALEXA_SKILL_ID`-Prüfung gegen `body.context.System.application.applicationId`, Timestamp-Fenster ±150 s, Dialog-Rückfrage (`shouldEndSession: false`) für fehlende `Minutes`, Fehlerpfad nutzt `IntentResult.ok`.
- Neu `src/lib/alexa-model.server.ts` + `src/routes/api/public/voice/alexa-model.ts`: baut `de-DE` Interaction Model (Intents wie bereits im Handler, Slot-Typ `PC_ENDPOINT` aus `getPiEndpoints()`), Download als JSON.
- `src/lib/wiring.functions.ts`: `alexa` um `skillIdSet`, `modelUrl` erweitern; neue Server-Funktion `alexaSelftest` (mintet lokal ein `access`-Token und ruft die Intent-Helfer direkt auf).
- `src/routes/_cloud/connections.alexa.tsx`: Checkliste, Download- und Testbutton.

Keine Datenbank, keine neuen Tabellen.
