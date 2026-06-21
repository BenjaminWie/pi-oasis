## Problem

`esbuild`'s prebuilt `linux-arm64` binary crashes with `SIGILL: illegal instruction` on the user's Raspberry Pi. This is a known incompatibility: recent esbuild releases (≥0.21, pulled in by Vite 7) are compiled by a Go toolchain that emits ARMv8.2+ instructions (notably `LSE` atomics), but Pi 4 / Pi 3 / CM4 cores are ARMv8.0-A and don't implement them. The CPU traps on the very first instruction of `esbuild --version`, and `npm install` aborts in the post-install hook.

This has nothing to do with our install script's shell — it's a binary/CPU mismatch. The fix has to happen inside `scripts/install.sh` (which `public/install.sh` calls), before the failing post-install runs.

## Fix

Update `scripts/install.sh` to detect this combination and build `esbuild` from source instead of using the prebuilt binary.

### Steps

1. **Detect the risk** before running `npm ci` / `npm install`:
   - `uname -m` is `aarch64` (or `arm64`), AND
   - `/proc/cpuinfo` does **not** advertise the `atomics` HWCAP (the LSE bit). This is the precise signal — present on ARMv8.1+, absent on Pi 4 / CM4 / Pi 3.

2. **When the risk is present**, prepare a from-source esbuild before `npm install`:
   - Ensure `go` is available. If not, `apt-get install -y golang-go` (with `sudo` when not root; warn and exit with a clear message if neither works).
   - `GOBIN=$HOME/.local/bin go install github.com/evanw/esbuild/cmd/esbuild@<version>` where `<version>` matches the esbuild version pinned by our lockfile (read from `package-lock.json` / `bun.lock`, fallback to `latest`). Building from source on the local CPU produces a binary the Pi can execute.
   - Export `ESBUILD_BINARY_PATH=$HOME/.local/bin/esbuild` for the rest of the script. The npm post-install honors this env var and skips the prebuilt-binary check that was triggering SIGILL.

3. **Then run** the existing `npm ci` (or `npm install` fallback) and `npm run build` as today. Print a short note when the workaround was applied so the user understands what happened.

4. **No changes to `public/install.sh`** are required — it already delegates to `scripts/install.sh`.

5. **README / DEPLOY note**: one short paragraph under the Pi install section explaining: "On ARMv8.0 boards (Pi 3, Pi 4, CM4) the installer automatically builds `esbuild` from source via Go; this adds ~1–2 minutes to first install." No action required from the user.

### Technical notes

- The `ESBUILD_BINARY_PATH` escape hatch is supported and documented by esbuild specifically for this scenario; it suppresses the install-time `--version` self-test that's crashing.
- Building esbuild from source on a Pi 4 takes ~60–90s and needs ~300 MB free disk. The Go toolchain from Debian's `golang-go` package (1.19+) is sufficient.
- We deliberately do **not** downgrade esbuild via an npm override — Vite 7 has a tight peer range and overriding it risks breaking the dev server. Building the same version from source is the safer fix.
- Pi 5 is ARMv8.2 and unaffected; the detection will skip the workaround there, so the install stays fast.
- If `go` cannot be installed (offline, non-Debian distro), the script exits with an actionable message pointing at the two manual options: install Go and re-run, or run on a Pi 5 / x86 host.

### Out of scope

- No app code, route, or UI changes.
- No change to PM2 / systemd flow.
- No change to the landing page or the published `install.sh` URL.
