## Goal
Make `curl -fsSL https://pi-hub.benniwie.com/install.sh | sh` actually work by serving a real install script from the site root that clones the public repo `https://github.com/BenjaminWie/pi-oasis` and runs the existing `scripts/install.sh` build flow.

## Changes

1. **Add `public/install.sh`** — a self-contained bootstrap script served statically at `/install.sh`. It will:
   - Refuse to run as root, check for `git`, `node` (>=20), and `npm`; print clear apt/nodesource hints if missing.
   - Pick an install directory (default `$HOME/pi-hub`, overridable via `PI_HUB_DIR=…`).
   - Clone `https://github.com/BenjaminWie/pi-oasis` (or `git pull` if it already exists).
   - Run the repo's `./scripts/install.sh` to install deps, write `.env`, and build.
   - Print next-step instructions for PM2 (recommended) and systemd, plus the `http://<host>:3000` URL.
   - Set `set -euo pipefail` and stream progress with simple `→`/`✓` markers consistent with the existing scripts.

2. **Add a GitHub-hosted fallback line** to the printed output and to README, so users can still install if the custom domain isn't reachable:
   `curl -fsSL https://raw.githubusercontent.com/BenjaminWie/pi-oasis/main/public/install.sh | sh`

3. **Verify the landing page** already references `https://pi-hub.benniwie.com/install.sh` (it does after the previous change) — no further UI edits needed.

4. **Static-asset sanity** — confirm files under `public/` are served at the site root by the TanStack Start / Vite setup (standard Vite behavior). No config change expected.

## Technical notes
- No backend, schema, or auth changes.
- The script targets Debian/Ubuntu/Raspberry Pi OS but degrades to printed instructions on other distros.
- Idempotent: re-running updates the checkout and rebuilds.
- Does not auto-install PM2 or enable systemd — those remain explicit follow-up commands so the bootstrap stays predictable.