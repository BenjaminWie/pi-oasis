#!/usr/bin/env bash
# Start the pi-hub production server. Requires a prior ./scripts/install.sh and build.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && . ./.env && set +a
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"
export NODE_ENV=production

if [ ! -f .output/server/index.mjs ]; then
  echo "ERROR: Production build missing (.output/server/index.mjs). Running build..." >&2
  npm run build
fi

echo "→ pi-hub production server on http://$HOST:$PORT"
exec node .output/server/index.mjs
