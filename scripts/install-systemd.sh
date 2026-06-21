#!/usr/bin/env bash
# Install and enable pi-hub as a systemd service.
# Run AFTER ./scripts/install.sh has built the project.
#
# PM2 is the recommended production runner — see ecosystem.config.cjs.
# Use this script only if you prefer raw systemd.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
NODE_BIN="$(command -v node)"

# Resolve the production entry the same way start.sh does.
ENTRY=""
for candidate in \
  "dist/server/server.js" \
  "dist/server/index.mjs" \
  ".output/server/index.mjs"
do
  if [ -f "$DIR/$candidate" ]; then
    ENTRY="$DIR/$candidate"
    break
  fi
done

if [ -z "$ENTRY" ]; then
  echo "ERROR: no built server entry found under $DIR." >&2
  echo "Run ./scripts/install.sh first." >&2
  exit 1
fi

UNIT=/etc/systemd/system/pi-hub.service

sudo tee "$UNIT" > /dev/null <<EOF
[Unit]
Description=Pi Hub
After=network-online.target docker.service
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
ExecStart=$NODE_BIN --max-old-space-size=192 $ENTRY
Restart=always
RestartSec=5
User=$USER_NAME
MemoryMax=250M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF

sudo usermod -aG docker "$USER_NAME" || true
sudo systemctl daemon-reload
sudo systemctl enable --now pi-hub

echo "✓ pi-hub service installed"
echo "  status:  sudo systemctl status pi-hub"
echo "  logs:    journalctl -u pi-hub -f"
echo "  open:    http://$(hostname).local:${PORT:-3000}"
