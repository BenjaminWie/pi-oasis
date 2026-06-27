# Pi Hub

Self-hosted home OS for your Raspberry Pi. Voice, chat, and Telegram —
agent-driven, cyberpunk, household-friendly.

Site: **https://pi-hub.benniwie.com**

- **Lightweight**: ~45 MB RSS, capped at 250 MB / 50% CPU
- **MQTT inspector**: auto-detects `mosquitto` / `emqx` / `hivemq` brokers
  exposing 1883
- **PIN auth + device trust**, LAN-only by default
- **PWA**: add to Home Screen for a native feel
- **Cloud bridge**: one-click pair from the Pi UI — sign into the cloud once,
  tokens transfer back automatically, the Pi long-polls for remote commands
- **Telegram voice**: speak to the bot, GPT-4o-mini-transcribe turns it into a
  command (status / containers / mqtt …)

---

## Install on your Pi

```bash
curl -fsSL https://pi-hub.benniwie.com/install.sh | sh
```

That's it. The installer:

1. Detects your arm64 Pi and checks for Node 20+ (installs it if missing).
2. Downloads the latest **prebuilt** `pi-hub-linux-arm64.tar.gz` from GitHub
   Releases — never compiles on the device.
3. Verifies the SHA256, extracts to `/opt/pi-hub`, generates a fresh PIN +
   factory-reset token.
4. Starts pi-hub under PM2 (capped at 220 MB RSS, auto-restart on crash).

When it's done, open `http://<pi>.local:3000` and log in with PIN **1234**
(change it in Settings on first login). Re-run the same command any time to
upgrade.

> **Pi 3 / Pi 4 users:** the old `./scripts/install.sh` path is gone for end
> users — it ran `npm install` + a full Vite build on-device and that's what
> killed your Pi. Use the one-liner above; it installs a prebuilt artifact in
> under a minute.

### Run as a service

PM2 is started automatically. To have it survive reboots, run the `sudo env …`
line that `pm2 startup` printed at the end of the install.

Prefer raw systemd? `./scripts/install-systemd.sh` writes a unit file.



## Run on your laptop (preview with mock data)

```bash
git clone <this-repo> pi-hub && cd pi-hub
./scripts/dev.sh                  # → http://localhost:5173
```

No Docker socket needed — mock containers and a fake MQTT broker stream so you
can see the UI end-to-end.

---

## Architecture

Native Node process, single binary. No Docker-in-Docker, no nginx reverse
proxy, no DB server. State is a tiny JSON file at `~/.pi-hub/state.json`
(PIN hash + trusted devices).

| Concern        | How                                                       |
| -------------- | --------------------------------------------------------- |
| Containers     | `dockerode` over `/var/run/docker.sock`                   |
| System stats   | direct reads of `/proc/stat`, `/proc/meminfo`, `vcgencmd` |
| Terminal       | `node-pty` shell streamed over WS to `xterm.js`           |
| MQTT inspector | `mqtt.js` subscribed to `#`, streamed to the browser      |
| Voice          | Web Speech API (browser-native, no API key)               |

See [DEPLOY.md](./DEPLOY.md) for the mock-to-real wiring.

## Why we run `vite dev` on the Pi

pi-hub runs the TanStack Start dev server under PM2 rather than a production
build. The prod server entry path moves between TanStack Start releases
(`dist/server/server.js` vs `.output/server/index.mjs`), which caused restart
loops on ARM. Dev mode boots in seconds, stays under ~500 MB RSS on a Pi 4,
and is what `scripts/start.sh` and `ecosystem.config.cjs` invoke.

## Real data vs demo

When pi-hub runs on a host with `/proc/stat` and `/var/run/docker.sock`
(i.e. your Pi), server functions read real Docker containers, real CPU/RAM
from `/proc`, real temperature from `vcgencmd`, and connect to real MQTT
brokers. Anywhere else — the public landing site, local laptop preview —
those same server functions fall back to mock data so the demo still works.

## Access from outside the house

Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`. The
dashboard stays bound to LAN; Tailscale gives you a private mesh address.
