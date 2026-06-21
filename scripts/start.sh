#!/usr/bin/env bash
# Start the built pi-hub server. Requires a prior ./scripts/install.sh build.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] && set -a && . ./.env && set +a
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"

# Resolve the production server entry. We support multiple paths because the
# build target can vary across versions of TanStack Start / Vite plugins.
ENTRY=""
for candidate in \
  "dist/server/server.js" \
  "dist/server/index.mjs" \
  ".output/server/index.mjs"
do
  if [ -f "$candidate" ]; then
    ENTRY="$candidate"
    break
  fi
done

if [ -z "$ENTRY" ]; then
  cat >&2 <<MSG
ERROR: no production build found.

Expected one of:
  dist/server/server.js
  dist/server/index.mjs
  .output/server/index.mjs

Run the build first:
  ./scripts/install.sh

This script intentionally does NOT auto-build at runtime — auto-builds caused
restart loops on low-memory devices. Run the install script once and then
restart this service.
MSG
  exit 1
fi

echo "→ pi-hub listening on http://$HOST:$PORT  (entry: $ENTRY)"
exec node --max-old-space-size=192 "$ENTRY"
