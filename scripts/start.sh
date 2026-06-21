#!/usr/bin/env bash
# Start the pi-hub dev server. Requires a prior ./scripts/install.sh.
#
# We intentionally run `vite dev` rather than a production build:
# TanStack Start's prod server entry path is unstable across versions on ARM,
# which caused restart loops. Dev mode is fast enough on a Pi 4.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && . ./.env && set +a
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"

if [ ! -d node_modules ]; then
  echo "ERROR: node_modules missing. Run ./scripts/install.sh first." >&2
  exit 1
fi

echo "→ pi-hub dev server on http://$HOST:$PORT"
exec npx vite dev --host "$HOST" --port "$PORT"
