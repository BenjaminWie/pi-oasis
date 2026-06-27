## Befund aus Logs und Code

- Google-Login selbst funktioniert: die Auth-Logs zeigen erfolgreiche Google-Logins (`/token` Status 200).
- Es wird aber kein Pairing erzeugt: `cloud_pairings` ist leer. Das heißt: der Flow erreicht den Cloud-Callback, der den Geräte-Token erzeugt, nicht zuverlässig.
- Aktuelle Schwachstelle: Der Pi öffnet die Cloud in einem Popup. Nach Google-OAuth bleibt der Nutzer in der Cloud/Auth-Seite hängen oder landet auf der Cloud-Startseite; der lokale Pi-Kontext ist weg. Das ist genau der Bruch, den du beschreibst.

## Ziel

Der Pi bleibt die führende Oberfläche. Die Cloud-Anmeldung passiert nur als kurzer Handshake. Nach erfolgreichem Login wird automatisch ein Token gemintet, vom Pi abgeholt und die UI zeigt verbunden an.

## Änderungen

1. **Cloud-Login robust machen**
   - In `src/routes/auth.tsx` nach jedem Seitenaufruf prüfen, ob bereits eine Cloud-Session existiert.
   - Wenn ja: automatisch zum berechneten Ziel weiterleiten, z. B. `/pair-callback?...`.
   - Dadurch funktioniert auch der OAuth-Rücksprung, bei dem Google wieder auf `/auth?...` landet.

2. **Google Redirect stabilisieren**
   - Google-OAuth nicht auf `window.location.href` verlassen.
   - Explizit auf die öffentliche Auth-Seite zurückleiten: `/auth?returnTo=pair-callback&local=...&nonce=...&hostname=...`.
   - Die Query bleibt erhalten, aber der Callback läuft erst nach bestätigter Session.

3. **Pi-Pairing ohne Weglaufen vom Pi**
   - Der lokale Settings-Screen bleibt offen und pollt weiter.
   - Popup bekommt klare Statusseite: „Anmeldung läuft“, „Gerät verknüpft“, „Du kannst zurück zum Pi“.
   - Falls Popup-Closing blockiert ist, ist das egal: der Pi pollt unabhängig und zeigt den Erfolg.

4. **Fehler sichtbarer machen**
   - Pairing-Callback zeigt konkrete Fehler, wenn Token-Minting fehlschlägt.
   - Pi-Settings zeigen verständliche Stati: Login offen, warte auf Cloud, verbunden, Timeout.

5. **Sicherheits-/Import-Fix am Claim-Endpunkt**
   - `src/routes/api/public/cloud-bridge/claim.ts` lädt den Admin-Client erst im Handler, nicht auf Modulebene.
   - Das ist sicherer für öffentliche Server-Routen und vermeidet Bundling-/Runtime-Risiken.

## Verifikation

- Prüfen, dass `/auth?returnTo=pair-callback&...` nach vorhandener oder neuer Google-Session automatisch zu `/pair-callback?...` navigiert.
- Prüfen, dass `cloud_pairings` nach Callback einen Eintrag bekommt.
- Prüfen, dass `/api/public/cloud-bridge/claim` mit derselben Nonce den Device-Token zurückgibt und den Eintrag als claimed markiert.
- Prüfen, dass der lokale Pi-Settings-Screen nach Polling `connected` anzeigt.

## Nicht ändern

- Keine neue Datenbankstruktur.
- Kein Umbau der bestehenden Geräte-/Token-Logik.
- Kein schwerer zusätzlicher Client-Code auf dem Pi.