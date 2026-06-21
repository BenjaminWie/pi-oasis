# Pi Hub

Self-hosted home OS for your Raspberry Pi. Voice, chat, and Telegram —
agent-driven, cyberpunk, household-friendly.

Site: **https://pi-hub.benniwie.com**

- **Lightweight**: ~45 MB RSS, capped at 250 MB / 50% CPU
- **MQTT inspector**: auto-detects `mosquitto` / `emqx` / `hivemq` brokers
  exposing 1883
- **PIN auth + device trust**, LAN-only by default
- **PWA**: add to Home Screen for a native feel

---

## Run on your Pi (3 commands)

```bash
git clone <this-repo> pi-hub && cd pi-hub
./scripts/install.sh
./scripts/start.sh                # → http://<pi>.local:3000
```

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

| Concern        | How                                                            |
|----------------|----------------------------------------------------------------|
| Containers     | `dockerode` over `/var/run/docker.sock`                        |
| System stats   | direct reads of `/proc/stat`, `/proc/meminfo`, `vcgencmd`      |
| Terminal       | `node-pty` shell streamed over WS to `xterm.js`                |
| MQTT inspector | `mqtt.js` subscribed to `#`, streamed to the browser           |
| Voice          | Web Speech API (browser-native, no API key)                    |

See [DEPLOY.md](./DEPLOY.md) for the mock-to-real wiring.

## Build artifact

`npm run build` emits the server entry at one of:

- `dist/server/server.js`
- `dist/server/index.mjs`
- `.output/server/index.mjs` (older layouts)

`scripts/start.sh`, `ecosystem.config.cjs`, and `scripts/install-systemd.sh`
all resolve to whichever one exists. If none exist, they fail with a clear
message — they no longer trigger a rebuild at runtime (which previously caused
restart loops on low-RAM Pis).

## Access from outside the house

Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`. The
dashboard stays bound to LAN; Tailscale gives you a private mesh address.
