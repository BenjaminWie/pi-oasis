
## Review of the current state

What's already in place:
- `.github/workflows/release.yml` builds `pi-hub-linux-arm64.tar.gz` (bundles `.output`, prod-only `node_modules` rebuilt under QEMU, `ecosystem.config.cjs`, `scripts/`). Runs on `v*` tag or manual dispatch.
- `scripts/bootstrap.sh` already tries to download the latest release and falls back to source.
- `public/install.sh` (served at `https://pi-hub.benniwie.com/install.sh`) currently clones the repo and runs the heavy `scripts/install.sh`.
- `scripts/install.sh` does `npm install` (all dev deps) + esbuild from-source rebuild on ARMv8.0 + `npm run build` on the Pi. **This is what kills the Pi 3** (1 GB RAM, no swap, building Vite + TanStack from source).
- `isSlimMode()` flag exists but only wired in `__root.tsx` and `overview.tsx`. Heavy deps (`framer-motion`, `recharts`, `embla-carousel`, all 25 Radix primitives, `cmdk`, `react-day-picker`, `vaul`, `input-otp`) ship to the Pi regardless.
- `dockerode`, `mqtt`, `node-pty`, `ssh2` are already correctly externalized.

Key problems to fix:
1. The advertised `curl … | sh` path still triggers an on-device build.
2. The release workflow doesn't auto-build on `main`, so there is rarely an artifact for `bootstrap.sh` to download — it silently falls back to the heavy path.
3. "Slim mode" only hides two UI strings — it doesn't actually reduce the JS payload or skip routes.
4. Landing/cloud-only routes (`/`, `/_cloud/*`, plugin timeline charts, framer-motion animations) are bundled into the Pi server build.

## Plan

### 1. GitHub release pipeline — make artifacts always available
- Add `push: branches: [main]` trigger to `release.yml` so every merge to main produces a `latest-dev` prerelease (the `softprops/action-gh-release` step already handles this with `make_latest` + `latest-dev` tag).
- Add a build-matrix sanity step that fails the release if `.output/server/index.mjs` is missing.
- Slim the bundle: exclude `agent/`, `src/`, `docs/`, `supabase/`, `public/` source from `release-bundle` (keep only runtime artifacts). Drop `package-lock.json` from the tarball — runtime doesn't need it.
- Add a SHA256 checksum file next to the tarball.

### 2. Bootstrap installer — prebuilt-only on the Pi
- Rewrite `public/install.sh` to be a thin wrapper that fetches and execs `scripts/bootstrap.sh` from the latest release tag (not from `main`), so users always get the matching script for the artifact they install.
- Rewrite `scripts/bootstrap.sh` so the prebuilt path is the **only** Pi path:
  - Detect arch / Node 20+ / available RAM, fail fast with a clear message if unmet.
  - Download `pi-hub-linux-arm64.tar.gz` + verify SHA256.
  - Extract to `/opt/pi-hub`, write `.env` + `~/.pi-hub/state.json` (PIN + factory token) — reuse the env-init block already in `scripts/install.sh`.
  - Install PM2 and start via `ecosystem.config.cjs`.
  - **Never** call `npm install`, **never** run `npm run build`, **never** install Go or rebuild esbuild.
- If no release asset is found, exit with an actionable message ("trigger the GitHub Action") instead of falling back to a 20-minute on-device compile.
- Rename `scripts/install.sh` to `scripts/dev-install.sh` and document it as **dev-only** (for contributors building on a beefy machine). Update `scripts/dev.sh` and README to match.

### 3. Slim runtime — actually shrink the Pi bundle
- Treat `VITE_PI_SLIM_MODE=true` as a **build-time** flag (already injected by the GH workflow into the release build) that drives:
  - Route-level exclusion via `createFileRoute` guards: under slim mode, redirect `/` and `/_cloud/*` to `/overview`. Cloud + landing routes stay in the repo but are tree-shaken via dynamic `import()` boundaries.
  - Replace `framer-motion` usage on Pi-side routes (`overview`, `mqtt`, `terminal`, `plugins`, `events`, `settings`) with plain CSS transitions. Keep framer-motion only on the landing/`_cloud` tree, loaded via `React.lazy`.
  - Replace `recharts` (Pi plugin timeline) with a ~2 KB inline SVG sparkline component. Recharts stays for the cloud audit/MCP pages only.
  - Audit and remove the unused Radix primitives from Pi routes (carousel, menubar, navigation-menu, hover-card, context-menu, calendar/day-picker, drawer/vaul, input-otp, cmdk). Keep them in `package.json` for the cloud build; mark Pi-only imports via a `src/components/ui/pi/` re-export barrel.
- Result target: Pi server JS bundle ≤ 1.5 MB (currently ~4–5 MB).

### 4. Runtime resource limits
- Lower `ecosystem.config.cjs` `max_memory_restart` from 400 M to 200 M and add `node_args: ["--max-old-space-size=192"]` (matches `install-systemd.sh`).
- Keep cloud-only background loops (plugin AI planner, MCP polling) gated behind `isSlimMode() === false || cloudPaired === true` so a stock Pi without cloud pairing stays idle.

### 5. Docs + verification
- Update `README.md` and `DEPLOY.md` so the **only** advertised install command is:
  ```
  curl -fsSL https://pi-hub.benniwie.com/install.sh | sh
  ```
- Add a `docs/pi-slim.md` table listing what's stripped on the Pi vs. what stays in the cloud.
- Verify by:
  - Running the new bootstrap in a `linux/arm64` Docker container with 512 MB cap and confirming it installs + starts without `npm install`.
  - Running `du -sh .output` after a slim build and asserting it shrank.
  - Listing Pi routes in dev (`vite dev` with `VITE_PI_SLIM_MODE=true`) and confirming `/cloud/*` redirects out.

### Technical notes
- The release workflow's `Rebuild production dependencies for arm64` step is correct (uses QEMU + native rebuild). Keep it but add `--ignore-scripts` for `esbuild` since the prebuilt arm64 binary is fine when built inside `node:20-bookworm-slim` (no SIGILL issue — that only hits the user's local install path).
- Slim build flag is set via `env: VITE_PI_SLIM_MODE=true` on the `npm run build` step inside the release job.
- The Cloudflare Worker landing build stays full-fat (separate `npm run build` without the flag, deployed via Lovable's existing pipeline) — nothing changes for `pi-hub.benniwie.com`.

After approval I'll implement in this order: workflow → bootstrap/install → slim build flag + route guards → dependency code-split → docs, with a verification run at the end.
