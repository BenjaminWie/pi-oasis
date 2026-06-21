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

# --- detect ARMv8.0 (Pi 3 / Pi 4 / CM4): prebuilt esbuild binaries SIGILL ---
NEEDS_ESBUILD_REBUILD=0
ARCH=$(uname -m)
if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
  if [ -r /proc/cpuinfo ] && ! grep -q '\batomics\b' /proc/cpuinfo; then
    NEEDS_ESBUILD_REBUILD=1
    echo "→ detected ARMv8.0 CPU (no LSE atomics) — will rebuild esbuild from source"
  fi
fi

ensure_go() {
  if command -v go >/dev/null; then return 0; fi
  echo "→ installing Go (needed to rebuild esbuild for this CPU)"
  if command -v apt-get >/dev/null; then
    if [ "$(id -u)" = "0" ]; then
      apt-get update && apt-get install -y golang-go
    elif command -v sudo >/dev/null; then
      sudo apt-get update && sudo apt-get install -y golang-go
    else
      echo "ERROR: need root or sudo to install golang-go"; return 1
    fi
  else
    cat >&2 <<MSG
ERROR: cannot install Go automatically on this distro.
Install Go 1.19+ manually (https://go.dev/dl/) and re-run this script.
MSG
    return 1
  fi
}

rebuild_esbuild_binaries() {
  ensure_go || exit 1
  export GOBIN="$PWD/.esbuild-bin"
  mkdir -p "$GOBIN"

  # For every esbuild package in node_modules, build a matching binary from source
  # and drop it at the path the postinstall would have populated.
  mapfile -t PKGS < <(find node_modules -type f -path '*/esbuild/package.json' 2>/dev/null || true)
  if [ "${#PKGS[@]}" -eq 0 ]; then
    echo "WARN: no esbuild packages found in node_modules"; return 0
  fi
  for pkg in "${PKGS[@]}"; do
    dir=$(dirname "$pkg")
    ver=$(node -p "require('./$pkg').version")
    out="$GOBIN/esbuild-$ver"
    if [ ! -x "$out" ]; then
      echo "→ building esbuild@$ver from source (this takes ~1–2 min on a Pi)"
      tmp=$(mktemp -d)
      (cd "$tmp" && GOBIN="$GOBIN" go install "github.com/evanw/esbuild/cmd/esbuild@v$ver")
      mv "$GOBIN/esbuild" "$out"
      rm -rf "$tmp"
    fi
    mkdir -p "$dir/bin"
    cp "$out" "$dir/bin/esbuild"
    chmod +x "$dir/bin/esbuild"
  done
  echo "✓ esbuild rebuilt for ${#PKGS[@]} package(s)"
}

# --- deps ---
echo "→ installing dependencies"
if [ "$NEEDS_ESBUILD_REBUILD" = "1" ]; then
  # Skip postinstall hooks (esbuild's would SIGILL), then patch in our binaries.
  npm install --ignore-scripts
  rebuild_esbuild_binaries
  # Now run the rest of the postinstalls (lifecycle scripts) with our binaries in place.
  npm rebuild --ignore-scripts=false || true
else
  npm install
fi

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
