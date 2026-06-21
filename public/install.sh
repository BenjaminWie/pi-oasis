#!/bin/sh
# pi-hub bootstrap installer (POSIX sh — safe to pipe to `| sh` on Debian/dash)
# Usage:
#   curl -fsSL https://pi-hub.benniwie.com/install.sh | sh
# Or directly from GitHub:
#   curl -fsSL https://raw.githubusercontent.com/BenjaminWie/pi-oasis/main/public/install.sh | sh
#
# Env overrides:
#   PI_HUB_DIR    install directory (default: $HOME/pi-hub)
#   PI_HUB_REPO   git repo URL (default: https://github.com/BenjaminWie/pi-oasis)
#   PI_HUB_REF    git branch/tag (default: main)

set -euo pipefail

REPO="${PI_HUB_REPO:-https://github.com/BenjaminWie/pi-oasis}"
REF="${PI_HUB_REF:-main}"
DIR="${PI_HUB_DIR:-$HOME/pi-hub}"

say()  { printf "\033[1;32m→\033[0m %s\n" "$*"; }
ok()   { printf "\033[1;32m✓\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m!\033[0m %s\n" "$*" >&2; }
die()  { printf "\033[1;31m✗\033[0m %s\n" "$*" >&2; exit 1; }

if [ "$(id -u)" = "0" ]; then
  die "Do not run as root. Run as your normal user; the script will use sudo only where needed."
fi

say "pi-hub installer"
say "repo: $REPO@$REF"
say "dir:  $DIR"

# --- prerequisites ---
MISSING=""
for bin in git node npm; do
  command -v "$bin" >/dev/null 2>&1 || MISSING="$MISSING $bin"
done

if [ -n "$MISSING" ]; then
  warn "missing:$MISSING"
  cat >&2 <<'HINT'

Install Node 20+ and git on Debian/Ubuntu/Raspberry Pi OS:

  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt update && sudo apt install -y nodejs git

Then re-run this installer.
HINT
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node 20+ required (found $(node -v)). See: https://nodejs.org/"
fi
ok "node $(node -v), npm $(npm -v), git $(git --version | awk '{print $3}')"

# --- clone or update ---
if [ -d "$DIR/.git" ]; then
  say "existing checkout found — updating"
  git -C "$DIR" fetch --depth 1 origin "$REF"
  git -C "$DIR" checkout "$REF"
  git -C "$DIR" reset --hard "origin/$REF"
else
  if [ -e "$DIR" ]; then
    die "$DIR exists and is not a git checkout. Move it aside or set PI_HUB_DIR=…"
  fi
  say "cloning $REPO → $DIR"
  git clone --depth 1 --branch "$REF" "$REPO" "$DIR"
fi
ok "source ready at $DIR"

# --- build ---
cd "$DIR"
if [ ! -x "./scripts/install.sh" ]; then
  chmod +x ./scripts/*.sh 2>/dev/null || true
fi

if [ ! -f "./scripts/install.sh" ]; then
  die "scripts/install.sh missing in repo — wrong branch?"
fi

say "running scripts/install.sh (deps + build)"
./scripts/install.sh

# --- next steps ---
HOSTNAME_LOCAL="$(hostname).local"
cat <<DONE

$(ok "pi-hub installed at $DIR")

Run it now (foreground):
  cd $DIR && ./scripts/start.sh

Recommended (PM2 — survives reboots, restarts on crash):
  sudo npm install -g pm2
  cd $DIR && pm2 start ecosystem.config.cjs && pm2 save
  pm2 startup    # then run the sudo command it prints

Then open from any device on your LAN:
  http://${HOSTNAME_LOCAL}:3000

Default PIN: 1234  (change it in Settings on first login)

DONE
