#!/usr/bin/env bash
# Run the dashboard in dev mode with mocked Docker / MQTT data.
# Use this on your laptop to preview the UI without touching the Pi.
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
npm run dev
