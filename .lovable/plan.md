## Goal

When pi-hub is installed on a Raspberry Pi, the dashboard should show **real** data (real containers, real CPU/RAM/temp, real MQTT brokers). The hosted landing at `pi-hub.benniwie.com` keeps using the mock data as a marketing demo — nothing the public sees changes.

Also: stop fighting the broken TanStack Start production build and make the installed Pi service run `vite dev` under PM2, which is what actually works on your hardware (you proved it).

## What changes

### 1. Real data on the Pi (server functions)

Replace the mock returns in `src/lib/system.functions.ts` and `src/lib/mqtt.functions.ts` with real implementations, gated by a single helper `isPiRuntime()` that checks for `/proc/stat` + `/var/run/docker.sock`. When the helper returns `false` (Cloudflare Worker serving the landing, or local `vite dev` on your laptop), the server fn returns the existing mock data — so the landing demo is untouched.

Real implementations:
- **`getSystemStats`**: read `/proc/stat` (CPU%), `/proc/meminfo` (RAM), `/proc/uptime`, `os.hostname()`, and `vcgencmd measure_temp` (with `/sys/class/thermal/thermal_zone0/temp` fallback).
- **`listContainers` / `getContainer` / `containerAction`**: use `dockerode` against `/var/run/docker.sock`. Container logs via `container.logs({ tail: 200, stdout: true, stderr: true })`.
- **`listMqttBrokers`**: filter the real container list by image (`eclipse-mosquitto`, `emqx`, `hivemq`, `vernemq`) and exposed port 1883.
- **`pollMqttMessages` / `publishMqttMessage`**: open a short-lived `mqtt.connect("mqtt://host:1883")` per request, subscribe to filter, drain buffered messages, then close. Keep a small in-memory ring buffer keyed by broker+filter so the existing 1-second polling UI still works.

The `dockerode` and `mqtt` packages are added as deps but imported with dynamic `await import()` inside `.handler()`, so they never get bundled into the Cloudflare landing build.

### 2. PM2 runs `vite dev` (the thing that works)

You already discovered that the production build's server entry path is unstable on the Pi and `npm run dev` works reliably. Make that the supported path:

- `ecosystem.config.cjs`: switch from `script: "dist/server/server.js"` to `script: "npm"`, `args: "run dev -- --host 0.0.0.0 --port 3000"`, `interpreter: "none"`, drop the 192 MB memory cap (dev server needs ~400 MB on a Pi 4), `max_memory_restart: "600M"`.
- `scripts/install.sh`: skip `npm run build` and the "verify build artifact" step entirely. The install ends after `npm install` + `.env` creation. ARMv8.0 esbuild rebuild logic stays — `vite dev` still uses esbuild.
- `scripts/start.sh`: change to `exec npx vite dev --host 0.0.0.0 --port "${PORT:-3000}"` so foreground starts also work without a build.
- `public/install.sh`: update the printed "Run it now" section to lead with PM2 + dev mode and drop the systemd path (which had the NVM PATH issue you hit).
- `README.md` / `DEPLOY.md`: one short paragraph explaining why we run dev mode on the Pi (TanStack Start production entry path is brittle on ARM; dev mode is fast enough and stable).

### 3. Landing page (unchanged behavior)

- `src/routes/index.tsx`: no code change. The "demo" chat + terminal animations are already hardcoded JSX, not server-fn data.
- The `_authenticated/*` routes still ship in the Cloudflare bundle, but no one reaches them without a PIN. If a curious visitor does sign in on the hosted site, `isPiRuntime()` returns false there and they see the existing mock data — same as today.

## Technical notes

- `dockerode` and `mqtt` are pure-JS / Node-stream packages. They work under Node on the Pi. They are NOT loaded on Cloudflare because the dynamic `import()` only runs inside `.handler()` after the `isPiRuntime()` check returns true — Vite's Worker SSR bundler will tree-shake the unused branch and these deps only need to resolve at runtime on the Pi.
- `vcgencmd` is shelled out with `child_process.execFile` (300 ms timeout). Falls back to thermal_zone0 if missing (non-Pi Linux).
- Per-request MQTT connect/disconnect is intentional: keeps memory flat on a 1 GB Pi and avoids needing a connection registry. Connection setup on localhost is ~5 ms.
- No changes to auth, routing, RLS, or Lovable Cloud.

## Files touched

- `src/lib/system.functions.ts` — real impls + mock fallback
- `src/lib/mqtt.functions.ts` — real impls + mock fallback
- `src/lib/pi-runtime.server.ts` — new, `isPiRuntime()` helper
- `ecosystem.config.cjs` — run `npm run dev`
- `scripts/install.sh` — drop build step
- `scripts/start.sh` — exec vite dev
- `public/install.sh` — updated next-steps text
- `README.md`, `DEPLOY.md` — short note on dev-mode-on-Pi
- `package.json` — add `dockerode`, `mqtt`
