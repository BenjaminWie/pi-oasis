# Pi Hub — running on your Raspberry Pi

This app is built mobile-first as a TanStack Start app. In the Lovable preview
it uses **mocked** Docker / system data so you can see the UI working from
your phone. To get real container control and a real shell, deploy it natively
on the Pi.

## Why native, not Docker

Running the dashboard inside Docker means mounting `/var/run/docker.sock`,
`/proc`, `/sys`, a PTY device, and making `gemini-cli` reachable from inside —
each one is a footgun. A native Node process gets all of that for free and is
one `systemctl restart` away from any change.

## One-time install on the Pi

```bash
# 1) node + git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt update && sudo apt install -y nodejs git

# 2) clone & build (writes .env, runs npm install + npm run build)
sudo git clone <your-repo-url> /opt/pi-hub
sudo chown -R "$USER":"$USER" /opt/pi-hub
cd /opt/pi-hub
./scripts/install.sh
```

The build emits the server entry at `dist/server/server.js` (or
`dist/server/index.mjs` / `.output/server/index.mjs` depending on the build
preset). All start scripts auto-detect whichever one exists.

### Recommended: run with PM2

PM2 sidesteps the `$PATH` / NVM issues that raw systemd units hit on the Pi
and ships with log rotation and crash restarts.

```bash
sudo npm install -g pm2
cd /opt/pi-hub
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                       # run the sudo command it prints
```

### Alternative: systemd

```bash
cd /opt/pi-hub
./scripts/install-systemd.sh      # installs /etc/systemd/system/pi-hub.service
```

The unit pins `ExecStart` to the resolved build artifact and does NOT auto-build
at runtime — earlier versions did, which caused restart loops when the build
output landed at a different path than expected.

Open `http://raspberrypi.local:3000` from your phone, tap Share → Add to
Home Screen. Demo PIN is **1234** until you change it in Settings.

## Swap mocks for real backend

The mock layer lives in two files. Replace them on the Pi (the route /
component code stays the same):

### `src/lib/system.functions.ts`

Replace each handler with real reads:

```ts
import Docker from "dockerode";
import { promises as fs } from "fs";
import { execSync } from "child_process";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

export const listContainers = createServerFn({ method: "GET" }).handler(async () => {
  const cs = await docker.listContainers({ all: true });
  return cs.map((c) => ({
    id: c.Id.slice(0, 12),
    name: c.Names[0]?.replace(/^\//, "") ?? c.Id,
    image: c.Image,
    status: c.State === "running" ? "running" : c.State === "restarting" ? "restarting" : "exited",
    uptime: c.Status,
    ports: c.Ports.map((p) => String(p.PublicPort ?? p.PrivatePort)),
    network: Object.keys(c.NetworkSettings?.Networks ?? {})[0] ?? "bridge",
    cpu: 0,
    mem: 0,
  }));
});

export const getSystemStats = createServerFn({ method: "GET" }).handler(async () => {
  const meminfo = await fs.readFile("/proc/meminfo", "utf8");
  const totalKb = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? "0", 10);
  const freeKb = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] ?? "0", 10);
  const tempC = parseFloat(
    execSync("vcgencmd measure_temp")
      .toString()
      .replace(/[^\d.]/g, ""),
  );
  return {
    hostname: execSync("hostname").toString().trim(),
    uptime: execSync("uptime -p").toString().trim(),
    cpu: /* parse two snapshots of /proc/stat */ 0,
    ramUsedGb: (totalKb - freeKb) / 1024 / 1024,
    ramTotalGb: totalKb / 1024 / 1024,
    diskUsedPct: parseInt(execSync("df / | awk 'NR==2{print $5}'").toString(), 10),
    tempC,
    version: "v2.0.4-β",
  };
});
```

### `src/lib/auth.functions.ts`

Replace with bcrypt + better-sqlite3 + signed JWT in an httpOnly cookie.
See `tanstack-server-runtime` for cookie helpers.

### Terminal (real PTY)

Add a server route at `src/routes/api/terminal.ts` that upgrades to WebSocket
and pipes `node-pty` (`spawn("bash", [], { name: "xterm-color" })`) stdin/stdout.
Replace the `fakeRespond` logic in `terminal.tsx` with an xterm.js instance
connected to that WS. Voice input already works — the recognised text gets
written to the same input which goes to the PTY.

## Access from outside the house

Install Tailscale on the Pi (`curl -fsSL https://tailscale.com/install.sh | sh`).
The dashboard stays bound to LAN, but Tailscale gives you a private mesh
address you can reach from anywhere without opening ports.
