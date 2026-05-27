#!/usr/bin/env bash
# Start the built dashboard. Run ./scripts/install.sh first.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && . ./.env && set +a
PORT="${PORT:-3000}"

if [ ! -d .output ]; then
  echo "→ no build found, running install"
  ./scripts/install.sh
fi

echo "→ pi-dashboard listening on http://0.0.0.0:$PORT"
exec node --max-old-space-size=128 .output/server/index.mjs
