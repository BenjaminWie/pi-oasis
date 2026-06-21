#!/usr/bin/env bash
# One-time setup on the Pi (or any Linux box with Node 20+).
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
HOST=0.0.0.0
PI_DASHBOARD_PIN=1234
EOF
  echo "→ wrote .env (PIN: 1234 — change in Settings)"
fi

# --- build ---
echo "→ building production bundle"
npm run build

# --- verify build artifact ---
FOUND=""
for candidate in \
  "dist/server/server.js" \
  "dist/server/index.mjs" \
  ".output/server/index.mjs"
do
  if [ -f "$candidate" ]; then
    FOUND="$candidate"
    break
  fi
done

if [ -z "$FOUND" ]; then
  cat >&2 <<MSG
ERROR: build completed but no server entry was found.
Looked for: dist/server/server.js, dist/server/index.mjs, .output/server/index.mjs
MSG
  exit 1
fi

echo
echo "✓ install done  (entry: $FOUND)"
echo "  start (foreground):  ./scripts/start.sh"
echo "  recommended (PM2):   pm2 start ecosystem.config.cjs && pm2 save"
echo "  alternative (systemd): ./scripts/install-systemd.sh"
