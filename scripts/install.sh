#!/usr/bin/env bash
# One-time setup on the Pi (or any Linux box with Docker + Node 20+).
set -euo pipefail

cd "$(dirname "$0")/.."

# --- node check ---
if ! command -v node >/dev/null; then
  echo "ERROR: node is not installed. Install Node.js 20+ first:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
  echo "  sudo apt install -y nodejs"
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node 20+ required (found $(node -v))"
  exit 1
fi

# --- deps ---
echo "→ installing dependencies"
if command -v npm >/dev/null; then npm install; fi

# --- env ---
if [ ! -f .env ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env <<EOF
SESSION_SECRET=$SECRET
PORT=3000
PI_DASHBOARD_PIN=1234
EOF
  echo "→ wrote .env (PIN: 1234 — change in Settings)"
fi

# --- build ---
echo "→ building production bundle"
npm run build

echo
echo "✓ install done"
echo "  start:           ./scripts/start.sh"
echo "  install systemd: ./scripts/install-systemd.sh"
