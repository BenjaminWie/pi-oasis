## Goal

A mobile-first PWA you open from your phone on the home network to:
- See your Pi's containers (running/failing), CPU/RAM/disk/temp
- Start/stop/restart containers and tail logs
- Drive a full shell (xterm.js) with `gemini-cli` available
- Push-to-talk: speak into your phone → text → executed as a gemini prompt

Visual: "Industrial Cyberpunk v2" — dark `#0a0a0c`, neon accent `#00f0ff`, status green/amber/red, IBM Plex Mono + Inter.

---

## What gets built in Lovable

A TanStack Start app — mobile-first, installable as a PWA.

### Routes

```
/                       → redirects based on auth
/login                  → PIN keypad (4–6 digit), "trust this device" toggle
/_authenticated/
  overview              → Pi header + CPU/RAM/Temp gauges + container list
  container/$id         → detail + logs (auto-tail) + Stop/Restart/Shell
  terminal              → full-screen xterm.js + mic FAB
  settings              → change PIN, manage trusted devices, host info
```

### Backend (TanStack server functions + WebSocket route)

- `POST /api/auth/pin` — verify PIN (bcrypt), issue signed device token cookie (httpOnly)
- `getSystemStats` — reads `/proc/stat`, `/proc/meminfo`, `df`, `vcgencmd measure_temp`
- `listContainers` / `getContainer($id)` / `containerAction(id, start|stop|restart)` / `getLogs(id)` — calls `/var/run/docker.sock` via `dockerode`
- `WS /api/terminal` — spawns `node-pty` shell, streams stdin/stdout to xterm.js
- `POST /api/stt` — optional Whisper proxy (only if browser STT isn't enough)

Voice: use the browser's built-in **Web Speech API** first (free, on-device on iOS/Android Chrome). Mic FAB → transcribe → prefix with `gemini ` and send through the same PTY. ElevenLabs Scribe as a fallback if you want better accuracy later.

### Design system

Tokens straight from the chosen prototype, ported into `src/styles.css` (oklch equivalents of `#0a0a0c`, `#141418`, `#00f0ff`, `#39ff14`, `#ffb000`, `#ff3e3e`). Inter + IBM Plex Mono via Google Fonts. Soft neon glows, ping animation on status dots, breathing accent bar on the active nav.

---

## Auth model (PIN + device trust)

- PIN stored as bcrypt hash in a local SQLite file (`~/.pi-dashboard/db.sqlite`) — no internet required.
- On successful PIN entry with "trust this device", server signs a 90-day JWT and sets it as an httpOnly cookie. Future visits skip the PIN.
- Settings page lists trusted devices (user-agent + last seen) and lets you revoke any.
- Brute-force protection: 5 wrong PINs → 60s lockout, doubles each cycle.

---

## How it runs on the Pi

**Native Node process (recommended, what you picked).** This gets Docker socket and `/proc` access without container gymnastics.

### Install on the Pi

```bash
# one-time
curl -fsSL https://get.gemini.dev | sh           # gemini-cli
sudo apt install nodejs npm
git clone <your-repo> /opt/pi-dashboard
cd /opt/pi-dashboard && npm install && npm run build

# systemd service
sudo tee /etc/systemd/system/pi-dashboard.service <<'EOF'
[Unit]
Description=Pi Dashboard
After=docker.service

[Service]
ExecStart=/usr/bin/node /opt/pi-dashboard/.output/server/index.mjs
Restart=always
User=pi
Environment=PORT=3000
Environment=SESSION_SECRET=<generated>

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now pi-dashboard
```

Then open `http://raspberrypi.local:3000` from your phone, add to home screen → installs as PWA.

### Why not Docker for the dashboard itself

You'd need `--privileged` or to mount `/var/run/docker.sock`, `/proc`, `/sys`, a PTY device, AND make `gemini-cli` reachable inside. Each of those is a footgun. Native process is one `systemctl restart` and you're done.

If you ever do want Docker: `docker run --network host -v /var/run/docker.sock:/var/run/docker.sock -v /proc:/host/proc:ro --pid=host pi-dashboard` — but skip this for v1.

### Network access

LAN-only by default (bind to `0.0.0.0:3000`). For outside-the-house access later: Tailscale on the Pi → reach `http://raspberrypi:3000` from anywhere without opening ports.

---

## Voice → gemini-cli flow

1. Tap mic FAB on `/terminal`
2. Browser SpeechRecognition starts, shows live transcript in the input bar
3. Release to send → text is prefixed (configurable, default `gemini `) and written to the PTY
4. Output streams back into xterm.js in real time

This works on iOS Safari 14.5+ and Chrome on Android out of the box. No API key, no cloud roundtrip.

---

## Technical details

- **Stack**: TanStack Start v1, React 19, Tailwind v4, xterm.js, dockerode, node-pty, ws, bcryptjs, better-sqlite3
- **State**: TanStack Query for container list (5s polling) + stats (2s polling); WS for logs + terminal
- **PWA**: manifest + service worker for "Add to Home Screen" and offline shell of the login page
- **Mobile-first**: viewport set to mobile in the editor; everything sized for 390px width; bottom nav with safe-area-inset padding
- **Security**: PIN hash never leaves the server; WS upgrade requires the device cookie; PTY runs as the `pi` user (not root); rate-limit on `/api/auth/pin`

---

## Build phases

1. **Shell + design system** — TanStack route tree, tokens, fonts, bottom nav, mocked data
2. **PIN auth** — keypad UI, SQLite, JWT cookie, `_authenticated` guard
3. **System stats + container list** — dockerode wiring, gauges, status cards, polling
4. **Container detail + log tail** — WS log stream, action buttons
5. **Terminal** — xterm.js + node-pty WS + mic FAB with Web Speech API
6. **Settings + trusted devices**
7. **PWA manifest + service worker**
8. **Deployment doc** — the systemd snippet above, plus a `scripts/install-on-pi.sh`

Each phase is testable on the Pi independently. Phase 1 ships immediately so you can see the look on your phone while the rest is built.

---

## Open question before I start

Lovable's preview runs in the cloud, so phases 3–5 (Docker socket, PTY, `/proc`) can't be exercised in preview — they only light up once deployed to the Pi. I'll build them with realistic mocked data and you'll test live on the Pi. OK to proceed that way, or do you want me to first stub out a tiny "demo mode" backend so the preview shows fake-but-live containers?