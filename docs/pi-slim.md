# Pi-Hub Slim Runtime

The build that ships to the Raspberry Pi is intentionally minimal. The full
feature set still exists in the codebase — it just isn't loaded on the
device.

## Install paths

| Audience          | Command                                                   | What runs                                                                                                                        |
| ----------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **End user (Pi)** | `curl -fsSL https://pi-hub.benniwie.com/install.sh \| sh` | Downloads the prebuilt `pi-hub-linux-arm64.tar.gz` from GitHub Releases and starts it under PM2. **No `npm install`, no build.** |
| **Contributor**   | `./scripts/install.sh`                                    | Full local build (Vite, esbuild, all dev deps). Requires ≥ 4 GB RAM. Marked dev-only in the script header.                       |
| **Cloud**         | Lovable deploy pipeline                                   | Full landing + cloud dashboard at `pi-hub.benniwie.com`. Built without `VITE_PI_SLIM_MODE`.                                      |

## What's stripped on the Pi

The release build is produced with `VITE_PI_SLIM_MODE=true`. At runtime
`isSlimMode()` flips the following:

| Surface                                     | Pi (slim)                                                                          | Cloud (full)                    |
| ------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| Landing route `/`                           | Redirects to `/overview` before render — framer-motion + marketing tree never load | Full animated cyberpunk landing |
| `/_cloud/*` (devices, telegram, MCP, audit) | Not reachable                                                                      | Available                       |
| Plugin charts                               | Inline SVG sparkline                                                               | Recharts                        |
| Background loops (AI planner, MCP poll)     | Only run after cloud pairing                                                       | Always                          |

## What's bundled vs. external on the Pi

Externalized in `vite.config.ts` (loaded from `node_modules` at runtime, not
bundled): `dockerode`, `node-pty`, `ssh2`, `mqtt`.

Already absent from the Pi import graph and tree-shaken: `recharts`,
`embla-carousel`, `cmdk`, `react-day-picker`, `vaul`, `input-otp`, plus the
Radix `carousel`, `menubar`, `navigation-menu`, `hover-card`,
`context-menu`, `drawer` primitives.

## Resource budget

`ecosystem.config.cjs` enforces:

- `--max-old-space-size=192` (V8 heap cap)
- `max_memory_restart: 220M` (PM2 restarts if it grows past this)
- `restart_delay: 5000` ms

This keeps pi-hub well under 250 MB resident on a Pi 3.

## GitHub release pipeline

`.github/workflows/release.yml` runs on every push to `main` (publishing
`latest-dev`) and on `v*` tags (publishing the tagged release). It:

1. Builds with `VITE_PI_SLIM_MODE=true`.
2. Verifies `.output/server/index.mjs` exists.
3. Rebuilds production-only deps for `linux/arm64` under QEMU.
4. Ships `pi-hub-linux-arm64.tar.gz` + `.sha256` to the release page.

The bootstrap script verifies the SHA256 before extracting.
