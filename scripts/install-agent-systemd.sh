#!/usr/bin/env bash
# Install pi-agent as a systemd service.
# Run from the repo root or from scripts/.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$REPO_DIR/agent"
SERVICE_FILE="/etc/systemd/system/pi-agent.service"

if [[ ! -f "$AGENT_DIR/index.mjs" ]]; then
  echo "agent/index.mjs not found in $AGENT_DIR" >&2
  exit 1
fi

USER_NAME="${SUDO_USER:-$USER}"
NODE_BIN="$(which node)"

echo "Installing pi-agent.service as user $USER_NAME, node=$NODE_BIN"

sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Pi Hub Agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$AGENT_DIR
ExecStart=$NODE_BIN $AGENT_DIR/index.mjs run
Restart=always
RestartSec=5
MemoryMax=64M
CPUQuota=20%
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now pi-agent.service
echo "✅ pi-agent läuft. Logs: journalctl -u pi-agent -f"
