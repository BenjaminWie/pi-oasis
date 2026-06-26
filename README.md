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

## Run on your Pi (3 commands)

```bash
git clone <this-repo> pi-hub && cd pi-hub
./scripts/install.sh
./scripts/start.sh                # → http://<pi>.local:3000
```

> On ARMv8.0 boards (Pi 3, Pi 4, CM4) the installer detects the CPU and rebuilds
> `esbuild` from source via Go to work around a known `SIGILL` in the prebuilt
> `linux-arm64` binary. This adds ~1–2 minutes to the first install. Pi 5 and
> x86 hosts are unaffected.

### Run as a background service (recommended: PM2)

PM2 avoids the `$PATH` / NVM headaches that bite raw systemd units on the Pi
and gives you log rotation and restart-on-crash out of the box.

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                       # follow the printed sudo command
```

### Alternative: systemd

```bash
./scripts/install-systemd.sh
```

Default PIN is **1234** — change it in Settings on first login.

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
