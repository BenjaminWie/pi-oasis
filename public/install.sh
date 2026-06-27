#!/bin/sh
# pi-hub installer (served at https://pi-hub.benniwie.com/install.sh)
#
# Thin wrapper that downloads the matching bootstrap.sh from the latest
# GitHub release and executes it. The bootstrap installs the prebuilt
# arm64 artifact — it does NOT compile anything on the device.
#
#   curl -fsSL https://pi-hub.benniwie.com/install.sh | sh
#
# Env overrides (forwarded):
#   PI_HUB_DIR, PI_HUB_REPO, PI_HUB_TAG
set -eu

REPO="${PI_HUB_REPO:-BenjaminWie/pi-oasis}"
REF="${PI_HUB_BOOTSTRAP_REF:-main}"
URL="https://raw.githubusercontent.com/$REPO/$REF/scripts/bootstrap.sh"

TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT

if ! curl -fsSL -o "$TMP" "$URL"; then
  echo "ERROR: could not download $URL" >&2
  exit 1
fi

exec sh "$TMP" "$@"
