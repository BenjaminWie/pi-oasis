# Pi Hub Agent

Tiny zero-deps Node agent that lives on your Pi and talks **only outbound HTTPS**
to the Lovable Cloud relay. No open ports, no exposed services.

## Quick start on the Pi

```bash
# 1. Install Node ≥20 if you don't have it
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 2. Clone & enter
git clone <repo> ~/pi-hub && cd ~/pi-hub/agent

# 3. Register the device (get the pairing code from the Cloud UI -> Geräte)
node index.mjs register --url https://<your-cloud-url> --code ABCD1234

# 4. Run as a service
sudo ../scripts/install-agent-systemd.sh
```

## Commands

| Command | Purpose |
| --- | --- |
| `pi-agent register` | Pair this Pi with a Cloud user account |
| `pi-agent run` | Daemon: long-poll Cloud, execute commands |
| `pi-agent status` | One-shot local snapshot, prints JSON |
| `pi-agent unlink` | Delete config |

## What it can do

- Report CPU / RAM / temperature / disk / uptime
- List Docker containers, detect MQTT brokers
- Start / stop / restart containers (whitelisted in Cloud)
- Publish MQTT messages via `mosquitto_pub` if installed

## Security

- Outbound HTTPS only. No inbound ports.
- Device token (random 256-bit, sha256-hashed in DB).
- Cloud only forwards whitelisted command kinds — terminal stays LAN-only.
