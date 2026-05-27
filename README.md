# Pi Hub

Mobile-first dashboard for a Raspberry Pi running Docker. See your containers,
system stats, MQTT broker traffic, and drive a full shell with `gemini-cli`
voice input — all from your phone.

- **Lightweight**: ~45 MB RSS, capped at 200 MB / 50% CPU via systemd
- **MQTT inspector**: auto-detects `mosquitto` / `emqx` / `hivemq` / brokers
  exposing 1883
- **PIN auth + device trust**, LAN-only by default
- **PWA**: add to Home Screen for a native feel

---

## Run on your Pi (3 commands)

```bash
git clone <this-repo> pi-dashboard && cd pi-dashboard
./scripts/install.sh
./scripts/start.sh                # → http://<pi>.local:3000
```

To run on boot:

```bash
./scripts/install-systemd.sh
```

Default PIN is **1234** — change it in Settings on first login.

## Run on your laptop (preview with mock data)

```bash
git clone <this-repo> pi-dashboard && cd pi-dashboard
./scripts/dev.sh                  # → http://localhost:5173
```

No Docker socket needed — mock containers and a fake MQTT broker stream so you
can see the UI end-to-end.

---

## Architecture

Native Node process, single binary. No Docker-in-Docker, no nginx reverse
proxy, no DB server. State is a tiny JSON file at `~/.pi-dashboard/state.json`
(PIN hash + trusted devices).

| Concern        | How                                                            |
|----------------|----------------------------------------------------------------|
| Containers     | `dockerode` over `/var/run/docker.sock`                        |
| System stats   | direct reads of `/proc/stat`, `/proc/meminfo`, `vcgencmd`      |
| Terminal       | `node-pty` shell streamed over WS to `xterm.js`                |
| MQTT inspector | `mqtt.js` subscribed to `#`, streamed to the browser           |
| Voice          | Web Speech API (browser-native, no API key)                    |

See [DEPLOY.md](./DEPLOY.md) for the mock-to-real wiring.

## Access from outside the house

Install Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`. The
dashboard stays bound to LAN; Tailscale gives you a private mesh address.
