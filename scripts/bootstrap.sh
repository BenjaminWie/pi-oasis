#!/usr/bin/env bash
set -euo pipefail

# Pi Hub Bootstrap Script
# One-liner: curl -sSL https://raw.githubusercontent.com/benniwie/pi-hub/main/scripts/bootstrap.sh | bash

# Colors for modern UI
export BLUE='\033[0;34m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export RED='\033[0;31m'
export NC='\033[0m' # No Color
export BOLD='\033[1m'

# Icons
export CHECK="✓"
export INFO="ℹ"
export WARN="⚠"
export ERROR="✖"
export STEP="→"

# Default repository - CHANGE THIS if you fork the repo!
REPO="benniwie/pi-hub"
INSTALL_DIR="/opt/pi-hub"

echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${BLUE}║           Pi Hub Installation                ║${NC}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════╝${NC}"
echo

# 1. System Checks
echo -e "${STEP} Checking system compatibility..."
ARCH=$(uname -m)
if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
    echo -e "${RED}${ERROR} Error: Pi Hub requires a 64-bit OS (aarch64/arm64).${NC}"
    echo -e "Your architecture: $ARCH"
    exit 1
fi
echo -e "${GREEN}${CHECK} Architecture: $ARCH${NC}"

# 2. Dependency Checks
echo -e "${STEP} Checking dependencies..."

install_node() {
    echo -e "${YELLOW}${INFO} Installing Node.js 20...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
}

if ! command -v node >/dev/null; then
    install_node
else
    NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo -e "${YELLOW}${WARN} Node.js version $NODE_MAJOR is too old.${NC}"
        install_node
    fi
fi
echo -e "${GREEN}${CHECK} Node.js $(node -v)${NC}"

if ! command -v pm2 >/dev/null; then
    echo -e "${YELLOW}${INFO} Installing PM2...${NC}"
    sudo npm install -g pm2
fi
echo -e "${GREEN}${CHECK} PM2 $(pm2 -v)${NC}"

# 3. Download and Install
echo -e "${STEP} Fetching latest release from GitHub..."
LATEST_RELEASE=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")
LATEST_TAG=$(echo "$LATEST_RELEASE" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')

if [ -z "$LATEST_TAG" ]; then
    echo -e "${YELLOW}${WARN} Could not find a pre-built release. Falling back to source install...${NC}"
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$USER":"$USER" "$INSTALL_DIR"
    if [ ! -d "$INSTALL_DIR/.git" ]; then
        git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
    ./scripts/install.sh
else
    echo -e "${GREEN}${CHECK} Found release: $LATEST_TAG${NC}"
    ASSET_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/pi-hub-linux-arm64.tar.gz"

    echo -e "${STEP} Downloading pre-built assets..."
    sudo mkdir -p "$INSTALL_DIR"
    sudo chown "$USER":"$USER" "$INSTALL_DIR"

    # Download and extract directly to install dir
    curl -L "$ASSET_URL" | tar -xz -C "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    # Initialize .env and state if they don't exist (reusing logic from install.sh)
    if [ ! -f .env ]; then
        echo -e "${STEP} Initializing configuration..."
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
    fi
fi

# 4. Finalizing
echo -e "${STEP} Starting Pi Hub with PM2..."
pm2 start ecosystem.config.cjs
pm2 save
sudo pm2 startup | tail -n 1 | bash || true

echo
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║      Pi Hub installed successfully!          ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo
echo -e "${BOLD}Access the dashboard at:${NC}"
echo -e "  http://$(hostname).local:3000"
echo -e "  http://$(hostname -I | awk '{print $1}'):3000"
echo
echo -e "${YELLOW}Default PIN: 1234${NC} (Change it in Settings)"
echo
