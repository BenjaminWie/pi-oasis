## Goals

1. Cut runtime cost on the Pi so the dashboard barely registers
2. Auto-detect MQTT broker containers and let you watch live messages
3. One-command local run from a fresh `git clone`

---

## 1. Lightweight runtime

Target: <60 MB RSS idle, <2% CPU idle on a Pi 4.

- **Drop heavy deps**: no `better-sqlite3` (use a JSON file at `~/.pi-dashboard/state.json` — only stores PIN hash + trusted devices, <1 KB). No `bcryptjs` — use Node's built-in `scrypt` (zero deps, faster on ARM).
- **Polling discipline**: pause all `useQuery` polling when the tab is hidden (`refetchIntervalInBackground: false`, already default — confirm). Slow stats poll from 2s → 5s, container list 5s → 10s. Single shared `/api/snapshot` endpoint returns stats + container list in one round-trip instead of two.
- **Docker stats are expensive**: `docker stats` streams cost ~5% CPU per container. Skip per-container CPU/MEM in the list view; compute only on the detail page while it's open.
- **System stats**: read `/proc/stat` + `/proc/meminfo` directly (no `systeminformation` npm package — it forks subprocesses). `vcgencmd measure_temp` only every 5s, cached.
- **Logs & terminal**: WebSocket only opens when the route is mounted; closes on unmount. Log tail capped at 500 lines client-side.
- **Bundle**: strip unused Radix/shadcn components; the dashboard only needs Button, Card, Input, Sheet, Switch, Sonner. Prune the rest from `src/components/ui/` before build. Production build with Vite's default minify + brotli — served via built-in `node:http` (no Express).
- **Process**: single Node process, no clustering. `--max-old-space-size=128` flag in systemd unit.

Expected footprint: ~45 MB RSS, install size ~80 MB on disk.

## 2. MQTT message inspector

Auto-light-up when a broker is detected.

- **Detection**: on container list refresh, flag any container whose image matches `/mosquitto|emqx|hivemq|nanomq|vernemq/i` OR exposes port 1883/8883. Surface a small "MQTT" chip on the container card.
- **New route** `/_authenticated/mqtt`: appears in bottom nav only when ≥1 broker is detected.
- **Connection**: server-side `mqtt.js` client connects to the broker over the Docker bridge (`mqtt://<container-ip>:1883`). Optional username/password stored in `state.json`, per broker.
- **UI**: 
  - Topic filter input (default `#`)
  - Live scrolling list of `{ts, topic, payload, qos, retained}`, newest on top, capped at 500 messages
  - Tap a message → expand JSON payload (pretty-printed if parseable)
  - Pause / Resume / Clear buttons
  - Publish drawer: topic + payload + QoS + retain → publish button
- **Transport to browser**: same WebSocket as terminal (different path `/api/mqtt`), so we add zero new dependencies on the browser side beyond what's already there.
- **Preview mode**: a mock broker emits fake `home/sensors/*` messages every 2s so the UI is reviewable in Lovable.

## 3. Run locally from a clone

Add to repo root:

- **`scripts/install.sh`** — checks Node ≥20, runs `npm ci`, builds, writes `.env` from `.env.example` if missing (generates `SESSION_SECRET`).
- **`scripts/dev.sh`** — `npm run dev` with mock backend (what Lovable preview uses).
- **`scripts/start.sh`** — production: `node .output/server/index.mjs` with real Docker socket.
- **`README.md`** updated with a "Run on your Pi in 3 commands" section:

  ```bash
  git clone <repo> pi-dashboard && cd pi-dashboard
  ./scripts/install.sh
  ./scripts/start.sh         # http://<pi>:3000
  ```

  And a "Run on your laptop (preview only)" section:

  ```bash
  git clone <repo> pi-dashboard && cd pi-dashboard
  npm install
  npm run dev                # http://localhost:5173, mocks only
  ```

- **`DEPLOY.md`** trimmed: the systemd unit moves into `scripts/install-systemd.sh` so it's one command, not copy-paste.

---

## Technical notes

- Files touched: `src/lib/system.functions.ts`, `src/lib/auth.functions.ts` (swap bcryptjs → scrypt), new `src/lib/mqtt.functions.ts`, new `src/routes/_authenticated/mqtt.tsx`, new `src/routes/api/mqtt.ts` (WS), `src/components/BottomNav.tsx` (conditional MQTT tab), new `scripts/{install,dev,start,install-systemd}.sh`, `README.md`.
- New runtime deps (Pi only): `mqtt` (~200 KB, pure JS, no native). No new browser deps.
- The preview still runs the mock layer — MQTT mock included so you can review the inspector UI before deploying.

## Phasing

1. MQTT inspector UI + mock broker (visible in preview)
2. Lightweight refactor (deps swap, polling, snapshot endpoint, UI pruning)
3. `scripts/` + README rewrite
4. Wire real `mqtt.js` client (only matters on the Pi)
