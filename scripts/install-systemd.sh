#!/usr/bin/env bash
# Install and enable pi-dashboard as a systemd service.
# Run AFTER ./scripts/install.sh has built the project.
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SUDO_USER:-$USER}"

UNIT=/etc/systemd/system/pi-dashboard.service

sudo tee "$UNIT" > /dev/null <<EOF
[Unit]
Description=Pi Hub Dashboard
After=docker.service network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=$DIR
EnvironmentFile=$DIR/.env
ExecStart=/usr/bin/node --max-old-space-size=128 $DIR/.output/server/index.mjs
Restart=always
RestartSec=3
User=$USER_NAME
# Memory cap to keep the dashboard light on the Pi
MemoryMax=200M
CPUQuota=50%

[Install]
WantedBy=multi-user.target
EOF

sudo usermod -aG docker "$USER_NAME" || true
sudo systemctl daemon-reload
sudo systemctl enable --now pi-dashboard

echo "✓ pi-dashboard service installed"
echo "  status:  sudo systemctl status pi-dashboard"
echo "  logs:    journalctl -u pi-dashboard -f"
echo "  open:    http://$(hostname).local:${PORT:-3000}"
