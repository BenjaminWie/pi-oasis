## Ursache

Alexa POSTet an `/api/public/oauth/authorize?...&redirect_uri=https://layla.amazon.com/api/skill/link/<VENDOR_ID>`. In `getAlexaConsent` prüfen wir das gegen `alexa_oauth_clients.redirect_uris` — dort stehen die drei Amazon-Domains für diesen Vendor noch nicht, deshalb: **„redirect_uri not in allow list for this client".**

Die aktuelle Fehlermeldung zeigt zwar die URI, aber der User hat keine UI, sie hinzuzufügen — und wir loggen serverseitig nichts.

## Fix

### 1. Allow-List im UI pflegbar machen (`/connections/alexa`)
- Neue Server-Fn `updateAlexaClientRedirectUris({ id, redirect_uris })` in `src/lib/alexa-oauth.functions.ts` (`requireSupabaseAuth`, RLS via user_id).
- In `src/routes/_cloud/connections.alexa.tsx` pro Client eine kleine Sektion „Erlaubte Redirect-URIs" mit Liste + „URI hinzufügen"-Feld + „Entfernen".
- Button **„Alexa-Standard-URIs hinzufügen"** trägt mit einem Klick die drei Vendor-URIs ein, sobald der User seine Vendor-ID aus der Alexa-Konsole eingibt:
  - `https://layla.amazon.com/api/skill/link/{vendorId}`
  - `https://pitangui.amazon.com/api/skill/link/{vendorId}` (US)
  - `https://alexa.amazon.co.jp/api/skill/link/{vendorId}` (JP)

### 2. Consent-Fehler direkt handlungsfähig machen
- In `getAlexaConsent`: bei Mismatch zusätzlich die **aktuell erlaubten** URIs zurückgeben und in eine typed Error werfen (`code: "redirect_uri_mismatch"`, `data: { received, allowed, clientId }`).
- In `authorize.tsx` `errorComponent`: wenn `redirect_uri_mismatch`, zeige die empfangene URI groß, die bereits gespeicherten URIs, und einen Direktlink zu `/connections/alexa` mit Query `?highlight=<clientId>&suggest=<encoded uri>` — dort ist die neue URI vorausgefüllt, ein Klick fügt sie zur Allow-List hinzu.

### 3. Server-seitiges Logging
- In `getAlexaConsent` und `authorize-post.ts` bei jedem Mismatch/Unknown-Client `console.warn` mit `{ client_id, received_redirect_uri, allowed_redirect_uris }` — sichtbar in Cloud Worker Logs (`server-function-logs`).
- Einmal bei erfolgreichem Consent `console.info` mit approved client_id (kein PII).

### 4. Keine DB-Schema-Änderung
`alexa_oauth_clients.redirect_uris` existiert bereits als `text[]`; nur Werte werden gepflegt.

## Verifikation

1. `tsgo` typecheck.
2. In `/connections/alexa` einen Alexa-Standard-URI-Satz mit der Vendor-ID hinzufügen.
3. Im Alexa-Testflow „Enable Skill" → Consent-Screen rendert; Approve → 302 an `layla.amazon.com/...?code=&state=`.
4. Falls doch noch Mismatch: Fehlerseite zeigt jetzt die empfangene URI + One-Click-Fix zum Nachtragen.

## Nicht angefasst

OAuth-Token-Endpoint, Node-RED-Template, Migrations, Telegram, MCP.