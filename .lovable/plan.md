## Goal

Stop the remaining mocks (PIN change, terminal, Pi overview cards), wire local↔cloud as one flow (sign in once on the Pi → auto-pair, auto-bridge), and make the Telegram bot listen to voice notes.

## 1. Replace mocked dashboard interactions

### a) PIN change + reset
- New table `public.pi_pin_state` is not needed — keep the PIN on the Pi (single-device secret). Replace the `.env` PIN with a hashed PIN stored in `~/.pi-hub/state.json` (created on first install).
- `src/lib/auth.functions.ts`:
  - `verifyPin` reads the hash from `~/.pi-hub/state.json` (fallback to `PI_DASHBOARD_PIN` env if file missing).
  - New `changePin({ currentPin, newPin })` — verifies current, writes new bcrypt-ish hash (scrypt from `node:crypto`).
  - New `resetPinWithFactoryToken({ factoryToken, newPin })` — `factoryToken` is the random hex written to `~/.pi-hub/state.json` on first install and printed by `scripts/install.sh` so the user can recover when they forget the PIN.
- `src/routes/_authenticated/settings.tsx`: wire the "Change PIN" button to a modal calling `changePin`; add "Forgot PIN? Reset with factory token" link.

### b) Terminal — real command execution
- New server fn `runTerminalCommand({ cmd })` gated by `requirePiAuth`. On Pi runtime only, runs an allow-listed command set (`docker ps|logs|stats`, `df`, `free`, `uptime`, `journalctl -u pi-hub -n 50`, `vcgencmd ...`) via `execFile` with a 5 s timeout. Free-form shell access is **not** exposed (PTY + node-pty is too heavy for the Pi 4 dev-server setup).
- Add a `gemini <prompt>` branch that calls the Lovable AI Gateway (`google/gemini-3-flash-preview`) with a small system prompt that frames it as a Pi sysadmin assistant.
- `src/routes/_authenticated/terminal.tsx`: replace `fakeRespond` with `useServerFn(runTerminalCommand)`; render multi-line output in the existing scrollback. On non-Pi runtime, the server fn returns a friendly "preview mode" message and the existing demo replies for the landing site.

### c) Overview header values
- `src/routes/_authenticated/settings.tsx`: replace the hard-coded "pi-cluster-01 / 6.6.31-rpi / v2.0.4-β" rows with values from `getSystemStats` + a new `getHostInfo` server fn (reads `os.release()`, `os.platform()`, package.json version).
- Trusted-devices section: real list backed by `~/.pi-hub/state.json` (each successful `verifyPin` with `trust: true` records a row keyed by a cookie ID). "Revoke all" wipes that list and forces re-PIN.

## 2. Local ↔ cloud one-click bridge

Today the Pi-installed pi-hub and the standalone `agent/` are two processes; pairing means copy-pasting a code. Collapse it to one flow.

### a) In-process agent
- New `src/lib/cloud-bridge.server.ts` boots on the Pi at server startup (gated by `isPiRuntime()`). When `~/.pi-hub/cloud.json` exists it long-polls `${cloudUrl}/api/public/agent/poll` and executes commands via the existing `system.server.ts` (docker, mqtt) + `runTerminalCommand`. Heartbeats every 30 s with a snapshot.
- Boot hook: in `src/start.ts` (or `src/server.ts`), call `cloudBridge.startIfConfigured()` once after the server is ready. Cheap idle (sleeping fetch).

### b) One-click pair from the local Pi UI
- New settings card "Cloud bridge" on `_authenticated/settings.tsx` with one button: **"Sign in to cloud & enable remote access"**.
- Flow:
  1. Click opens a popup / new tab to `${PUBLIC_CLOUD_URL}/auth?return=pair&local=<localOrigin>` (uses the published `pi-hub.lovable.app` URL, configurable via `PI_HUB_CLOUD_URL` env).
  2. The cloud `/auth` page (existing Supabase email + Google flow) signs the user in, then on success redirects to `/_authenticated/pair-callback?local=<localOrigin>`.
  3. `pair-callback.tsx` calls a new server fn `mintLocalPairing()` → creates a `devices` row for `hostname`, returns `{ deviceId, deviceToken, cloudUrl }`, then POSTs that bundle to `${local}/api/public/cloud-bridge/install` (with a short-lived signed nonce so a stranger can't post one).
  4. New server route `src/routes/api/public/cloud-bridge/install.ts` runs on the Pi: validates the nonce (HMAC against the local PIN-secret) **and** confirms `request.headers.origin === local`, then writes `~/.pi-hub/cloud.json` and starts the bridge. Returns `{ ok: true, name }`.
  5. Popup closes; the local UI shows "✓ Bridged as <name>".
- Anti-CSRF for step 4: before opening the popup, the local UI calls `createPairingNonce()` (Pi-local server fn, returns a one-shot 5-min nonce signed with the existing `PI_DASHBOARD_SECRET`) and passes it in the URL. The cloud forwards it verbatim in step 3's POST; the Pi verifies HMAC + single-use.
- The PIN cookie still gates the UI; bridge install does not require a Supabase session on the Pi itself.

### c) Cloud activation
- Lovable Cloud is already enabled in this project; the published URL is `pi-hub.lovable.app`. No new infra. The local Pi just needs the published URL — defaults to `https://pi-hub.lovable.app`, overridable via `.env`.

## 3. Telegram voice messages

Wire `message.voice` and `message.audio` in `src/routes/api/public/telegram/webhook.$userId.ts`:

1. Detect `update.message.voice` (or `audio`) instead of `text`.
2. Call `https://api.telegram.org/bot<token>/getFile?file_id=...` → download from `https://api.telegram.org/file/bot<token>/<file_path>` (OGG/Opus).
3. Transcribe via Lovable AI Gateway `/v1/audio/transcriptions` with `openai/gpt-4o-mini-transcribe`, model name forwarded multipart; filename `voice.ogg`. Language: omit (auto-detect) so German users get German transcripts.
4. Echo the transcript back ("🎙 verstanden: «…»") and run it through the existing text-command dispatcher (`/status`, `/containers`, `/mqtt …`).
5. If the transcript doesn't match a slash-command, send it through Lovable AI (`google/gemini-3-flash-preview`) with a short system prompt: "You are a Pi home-automation assistant. Map the user's request to one of: status | containers | mqtt pub <topic> <msg>. Respond with just the command, or 'unclear'." Execute the mapped command.
6. Persist the transcript in `telegram_audit.command` so the existing audit page shows it.

`LOVABLE_API_KEY` is already provisioned (used by other AI calls) — read inside the handler.

## 4. Out of scope / not changed

- `agent/index.mjs` stays as an option for users who want the standalone agent, but `README.md` is updated to recommend the one-click in-process bridge.
- No new Supabase tables; we reuse `devices`, `agent_commands`, `telegram_audit`.
- Landing-page demo behavior unchanged.

## Files touched

- `src/lib/auth.functions.ts`, new `src/lib/pin-store.server.ts`, `src/lib/pi-auth.server.ts`
- `src/lib/terminal.functions.ts` (new), `src/routes/_authenticated/terminal.tsx`
- `src/routes/_authenticated/settings.tsx` (PIN modal, host info, trusted devices, Cloud-bridge card)
- `src/lib/host-info.functions.ts` (new)
- `src/lib/cloud-bridge.server.ts` (new), boot hook in `src/start.ts`
- `src/lib/cloud-pairing.functions.ts` (new — `createPairingNonce`, `mintLocalPairing`)
- `src/routes/_authenticated/pair-callback.tsx` (new, cloud-side)
- `src/routes/api/public/cloud-bridge/install.ts` (new, Pi-side)
- `src/routes/api/public/telegram/webhook.$userId.ts` (voice + AI intent mapping)
- `scripts/install.sh` (prints factory PIN-reset token after writing `~/.pi-hub/state.json`)
- `README.md` (one-click bridge section)
