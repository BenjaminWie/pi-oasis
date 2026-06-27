#!/usr/bin/env bash
# pi-hub bootstrap — downloads the latest prebuilt arm64 release.
# NEVER runs `npm install` or `npm run build` on the device.
#
# Usage:
#   curl -fsSL https://pi-hub.benniwie.com/install.sh | sh
#
# Env overrides:
#   PI_HUB_DIR   install dir (default: /opt/pi-hub)
#   PI_HUB_REPO  github owner/repo (default: BenjaminWie/pi-oasis)
#   PI_HUB_TAG   release tag (default: latest)

set -eu

REPO="${PI_HUB_REPO:-BenjaminWie/pi-oasis}"
TAG="${PI_HUB_TAG:-latest}"
DIR="${PI_HUB_DIR:-/opt/pi-hub}"
ASSET="pi-hub-linux-arm64.tar.gz"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'; BOLD='\033[1m'
say()  { printf "${BLUE}→${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$*" >&2; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

printf "${BOLD}${BLUE}╔══════════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${BLUE}║              Pi Hub Bootstrap                ║${NC}\n"
printf "${BOLD}${BLUE}╚══════════════════════════════════════════════╝${NC}\n\n"

# --- arch / OS check ---
ARCH=$(uname -m)
case "$ARCH" in
  aarch64|arm64) ok "architecture: $ARCH" ;;
  *) die "pi-hub releases ship arm64 binaries only — found $ARCH.
   Use a 64-bit Raspberry Pi OS, or run from source (see DEPLOY.md)." ;;
esac

# --- node check (runtime only — no build) ---
if ! command -v node >/dev/null 2>&1; then
  warn "node is not installed — installing Node.js 20…"
  if command -v sudo >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
  else
    die "node missing and no sudo available — install Node.js 20 manually"
  fi
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required (found $(node -v))"
ok "node $(node -v)"

# --- memory hint (no swap setup — just inform) ---
MEM_MB=$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)
if [ "$MEM_MB" -gt 0 ] && [ "$MEM_MB" -lt 700 ]; then
  warn "low RAM (${MEM_MB} MB). pi-hub runs fine but consider 256 MB swap."
fi

# --- resolve release ---
if [ "$TAG" = "latest" ]; then
  say "looking up latest release for $REPO"
  TAG_RESOLVED=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | grep -m1 '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/' || true)
  if [ -z "${TAG_RESOLVED:-}" ]; then
    # fall back to the auto-built prerelease
    TAG_RESOLVED="latest-dev"
    warn "no tagged release — falling back to $TAG_RESOLVED"
  fi
  TAG="$TAG_RESOLVED"
fi
ok "release: $TAG"

URL="https://github.com/$REPO/releases/download/$TAG/$ASSET"
SHA_URL="$URL.sha256"

# --- download ---
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
say "downloading $ASSET"
if ! curl -fL --retry 3 -o "$TMP/$ASSET" "$URL"; then
  die "could not download $URL
   Trigger the 'Release' GitHub Action and retry, or pin PI_HUB_TAG=vX.Y.Z."
fi
ok "downloaded $(du -h "$TMP/$ASSET" | cut -f1)"

# --- checksum (best-effort: only if .sha256 sidecar exists) ---
if curl -fsSL -o "$TMP/$ASSET.sha256" "$SHA_URL" 2>/dev/null; then
  (cd "$TMP" && sha256sum -c "$ASSET.sha256") || die "sha256 mismatch — aborting"
  ok "sha256 verified"
else
  warn "no sha256 sidecar published — skipping integrity check"
fi

# --- install dir ---
if [ ! -d "$DIR" ]; then
  say "creating $DIR"
  if [ "$(id -u)" = "0" ]; then
    mkdir -p "$DIR"
  else
    sudo mkdir -p "$DIR" && sudo chown "$USER":"$USER" "$DIR"
  fi
fi

# Stop any running instance before swapping files
if command -v pm2 >/dev/null 2>&1; then
  pm2 stop pi-hub >/dev/null 2>&1 || true
fi

say "extracting to $DIR"
tar -xzf "$TMP/$ASSET" -C "$DIR"
ok "extracted"

# --- .env + state init ---
cd "$DIR"
if [ ! -f .env ]; then
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > .env <<EOF
SESSION_SECRET=$SECRET
PORT=3000
HOST=0.0.0.0
PI_DASHBOARD_PIN=1234
PI_DASHBOARD_SECRET=$SECRET
VITE_PI_HUB_CLOUD_URL=https://pi-hub.benniwie.com
VITE_PI_SLIM_MODE=true
EOF
  ok "wrote .env (PIN: 1234 — change in Settings)"
fi

STATE_DIR="$HOME/.pi-hub"
STATE_FILE="$STATE_DIR/state.json"
if [ ! -f "$STATE_FILE" ]; then
  mkdir -p "$STATE_DIR" && chmod 700 "$STATE_DIR"
  FACTORY_TOKEN=$(node -e "
    const c=require('crypto'), fs=require('fs');
    const salt=c.randomBytes(16).toString('hex');
    const hash=c.scryptSync(process.env.PI_DASHBOARD_PIN||'1234', salt, 32).toString('hex');
    const tok=c.randomBytes(16).toString('hex');
    fs.writeFileSync('$STATE_FILE',
      JSON.stringify({pinHash:hash,pinSalt:salt,factoryToken:tok,trustedDevices:[]},null,2),
      {mode:0o600});
    console.log(tok);
  ")
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "  FACTORY RESET TOKEN — save it now (Settings → Reset PIN):"
  echo "    $FACTORY_TOKEN"
  echo "════════════════════════════════════════════════════════════════"
  echo
fi

# --- pm2 ---
if ! command -v pm2 >/dev/null 2>&1; then
  say "installing pm2"
  if [ "$(id -u)" = "0" ]; then npm install -g pm2; else sudo npm install -g pm2; fi
fi

say "starting pi-hub"
pm2 start ecosystem.config.cjs >/dev/null
pm2 save >/dev/null
# pm2 startup is optional and needs a tty for the sudo handshake — print it
pm2 startup systemd -u "$USER" --hp "$HOME" 2>/dev/null | tail -1 | grep -q '^sudo' && {
  warn "to start on boot, run the 'sudo env …' line that pm2 just printed above"
} || true

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
HOST_LOCAL="$(hostname).local"
echo
printf "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}\n"
printf "${BOLD}${GREEN}║      Pi Hub installed and running            ║${NC}\n"
printf "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}\n\n"
echo "  http://${HOST_LOCAL}:3000"
[ -n "$IP" ] && echo "  http://${IP}:3000"
echo
echo "  Default PIN: 1234   (change in Settings → PIN)"
echo "  Logs:        pm2 logs pi-hub"
echo "  Re-run:      curl -fsSL https://pi-hub.benniwie.com/install.sh | sh"
echo
