#!/usr/bin/env sh
# Publish the Pi-Hub running on this Pi through a Cloudflare Tunnel.
#
# Why: the cloud part of Pi-Hub becomes a pure relay (no database). For that it
# needs a stable https URL to reach the Pi — outbound only, no port forwarding,
# no dynamic DNS, no open router port.
#
# Usage:
#   ./scripts/install-tunnel.sh                 # quick tunnel (random *.trycloudflare.com URL)
#   ./scripts/install-tunnel.sh pi.example.com  # named tunnel on your own domain
set -eu

cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
HOSTNAME_ARG="${1:-}"

log() { printf '\033[36m→ %s\033[0m\n' "$*"; }
die() { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- cloudflared
if ! command -v cloudflared >/dev/null 2>&1; then
  log "Installing cloudflared…"
  ARCH="$(uname -m)"
  case "$ARCH" in
    aarch64|arm64) PKG=arm64 ;;
    armv7l|armv6l) PKG=arm ;;
    x86_64)        PKG=amd64 ;;
    *) die "unsupported architecture: $ARCH" ;;
  esac
  TMP="$(mktemp -d)"
  curl -fsSL -o "$TMP/cloudflared.deb" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${PKG}.deb"
  sudo dpkg -i "$TMP/cloudflared.deb"
  rm -rf "$TMP"
fi
log "cloudflared: $(cloudflared --version 2>/dev/null | head -1)"

# ------------------------------------------------------------------- ingest token
ENV_FILE=".env"
touch "$ENV_FILE"
if ! grep -q '^PI_INGEST_TOKEN=' "$ENV_FILE" 2>/dev/null; then
  TOKEN="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf 'PI_INGEST_TOKEN=%s\n' "$TOKEN" >> "$ENV_FILE"
  log "Generated PI_INGEST_TOKEN in .env"
fi
if ! grep -q '^PI_DASHBOARD_SECRET=' "$ENV_FILE" 2>/dev/null; then
  SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  printf 'PI_DASHBOARD_SECRET=%s\n' "$SECRET" >> "$ENV_FILE"
  log "Generated PI_DASHBOARD_SECRET in .env"
fi

# ------------------------------------------------------------------ quick mode
if [ -z "$HOSTNAME_ARG" ]; then
  cat <<EOF

Quick tunnel (no Cloudflare account needed, URL changes on every restart).
Watch the output for the https://<random>.trycloudflare.com URL, then put it
into .env as PI_HUB_PUBLIC_URL and restart pi-hub.

EOF
  exec cloudflared tunnel --url "http://localhost:${PORT}"
fi

# ------------------------------------------------------------------ named mode
TUNNEL_NAME="pi-hub"
if [ ! -f "$HOME/.cloudflared/cert.pem" ]; then
  log "Cloudflare login required — a browser URL will be printed."
  cloudflared tunnel login
fi
cloudflared tunnel list | grep -q " $TUNNEL_NAME " || cloudflared tunnel create "$TUNNEL_NAME"
cloudflared tunnel route dns "$TUNNEL_NAME" "$HOSTNAME_ARG" || true

CFG_DIR="/etc/cloudflared"
sudo mkdir -p "$CFG_DIR"
UUID="$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2==n {print $1}' | head -1)"
[ -n "$UUID" ] || die "could not determine tunnel id"

sudo tee "$CFG_DIR/config.yml" >/dev/null <<EOF
tunnel: $UUID
credentials-file: $HOME/.cloudflared/$UUID.json
ingress:
  - hostname: $HOSTNAME_ARG
    service: http://localhost:$PORT
  - service: http_status:404
EOF

sudo cloudflared service install || true
sudo systemctl enable --now cloudflared || true

# Persist the public URL so pi-hub enforces token auth on every route.
if grep -q '^PI_HUB_PUBLIC_URL=' "$ENV_FILE"; then
  sed -i "s#^PI_HUB_PUBLIC_URL=.*#PI_HUB_PUBLIC_URL=https://$HOSTNAME_ARG#" "$ENV_FILE"
else
  printf 'PI_HUB_PUBLIC_URL=https://%s\n' "$HOSTNAME_ARG" >> "$ENV_FILE"
fi

cat <<EOF

✅ Tunnel aktiv: https://$HOSTNAME_ARG  →  http://localhost:$PORT

Nächste Schritte:
  1. pi-hub neu starten:  pm2 restart pi-hub   (oder ./scripts/start.sh)
  2. In der Cloud-App als Secrets hinterlegen:
       PIHUB_PI_URL       = https://$HOSTNAME_ARG
       PIHUB_DEVICE_TOKEN = \$(grep ^PI_INGEST_TOKEN .env | cut -d= -f2)

EOF
