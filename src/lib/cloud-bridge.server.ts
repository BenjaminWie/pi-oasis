// In-process cloud bridge running on the Pi. When ~/.pi-hub/state.json
// contains a `cloud` section, long-polls the cloud relay and executes
// agent_commands locally (docker / mqtt / status / terminal).
// Auto-starts once the first server fn calls `isPiRuntime()`.

let started = false;
let stopRequested = false;

export async function snapshot() {
  try {
    const { readRealSystemStats, listRealContainers } = await import("./system.server");
    const [stats, containers] = await Promise.all([
      readRealSystemStats(),
      listRealContainers().catch(() => []),
    ]);
    const { listPluginsStore } = await import("./plugins-store.server");
    const plugins = await listPluginsStore().catch(() => []);

    return {
      ...stats,
      ram: stats.ramTotalGb ? (stats.ramUsedGb / stats.ramTotalGb) * 100 : null,
      temp: stats.tempC,
      disk: stats.diskUsedPct,
      containers: containers.map((c) => ({
        id: c.id,
        name: c.name,
        image: c.image,
        status: c.status,
        uptime: c.uptime,
        ports: c.ports,
        network: c.network,
        cpu: c.cpu,
        mem: c.mem,
        isMqtt: c.isMqtt,
      })),
      mqtt_brokers: containers.filter((c) => c.isMqtt).map((c) => c.name),
      plugins: plugins.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        enabled: p.enabled,
        commands: p.commands,
      })),
    };
  } catch {
    return null;
  }
}

async function execCommand(cmd: any) {
  try {
    if (cmd.kind === "status") {
      const snap = await snapshot();
      return { ok: true, result: snap };
    }
    if (cmd.kind === "container_action") {
      const { runContainerAction } = await import("./system.server");
      await runContainerAction(cmd.payload.name, cmd.payload.action);
      return { ok: true, result: { name: cmd.payload.name, action: cmd.payload.action } };
    }
    if (cmd.kind === "mqtt_publish") {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const exec = promisify(execFile);
      const host = String(cmd.payload.broker || "127.0.0.1");
      if (!/^[a-zA-Z0-9_.\-:]{1,253}$/.test(host)) {
        return { ok: false, result: { error: "invalid broker host" } };
      }
      const port = Number(cmd.payload.port ?? 1883);
      await exec(
        "mosquitto_pub",
        [
          "-h",
          host,
          "-p",
          String(port),
          "-t",
          String(cmd.payload.topic),
          "-m",
          String(cmd.payload.payload || ""),
        ],
        { timeout: 5000 },
      );
      return { ok: true, result: { topic: cmd.payload.topic } };
    }
    if (cmd.kind === "terminal") {
      const { executeTerminalCommand } = await import("./terminal.functions");
      const res = await executeTerminalCommand(cmd.payload.cmd);
      return { ok: true, result: res };
    }
    if (cmd.kind === "system_reboot") {
      const { execFile } = await import("node:child_process");
      // Schedule reboot in 5s so we can ack the command first.
      execFile("sh", ["-c", "(sleep 5 && sudo /sbin/reboot) &"], { timeout: 2000 }, () => {});
      return { ok: true, result: { scheduled: true, in_seconds: 5 } };
    }
    if (cmd.kind === "plugin_list") {
      const { listPluginsStore } = await import("./plugins-store.server");
      return { ok: true, result: { plugins: await listPluginsStore() } };
    }
    if (cmd.kind === "plugin_get") {
      const {
        getPluginStore,
        getPlanStore,
        listDecisionsStore,
        getSimStateStore,
      } = await import("./plugins-store.server");
      const id = String(cmd.payload?.id ?? "");
      const plugin = await getPluginStore(id);
      if (!plugin) return { ok: false, result: { error: "plugin not found" } };
      const [plan, decisions, simState] = await Promise.all([
        getPlanStore(id),
        listDecisionsStore(id, 50),
        getSimStateStore(id),
      ]);
      return { ok: true, result: { plugin, plan, decisions, simState } };
    }
    if (cmd.kind === "plugin_run_planner") {
      const { getPluginStore, setPlanStore } = await import("./plugins-store.server");
      const plugin = await getPluginStore(String(cmd.payload?.id ?? ""));
      if (!plugin) return { ok: false, result: { error: "plugin not found" } };
      const { buildPlan } = await import("./ai-planner.server");
      const plan = await buildPlan(plugin);
      await setPlanStore(plan);
      return { ok: true, result: { plan } };
    }
    if (cmd.kind === "plugin_manual") {
      const { queueOverrideStore, recordDecisionStore, getPluginStore } = await import(
        "./plugins-store.server"
      );
      const id = String(cmd.payload?.id ?? "");
      const action = cmd.payload?.action === "off" ? "off" : "on";
      const minutes = Math.max(1, Math.min(120, Number(cmd.payload?.minutes) || 10));
      const plugin = await getPluginStore(id);
      if (!plugin) return { ok: false, result: { error: "plugin not found" } };
      await queueOverrideStore({
        pluginId: id,
        action,
        validUntilIso: new Date(Date.now() + minutes * 60_000).toISOString(),
        consumed: false,
      });
      await recordDecisionStore({
        pluginId: id,
        action: action === "on" ? "manual_on" : "manual_off",
        reason: `MCP override — ${action.toUpperCase()} for ${minutes}m`,
        simulated: (plugin.config as any).simulated,
      });
      return { ok: true, result: { ok: true, action, minutes } };
    }
    if (cmd.kind === "plugin_create") {
      const { createPluginStore } = await import("./plugins-store.server");
      const p = await createPluginStore(
        cmd.payload.kind,
        cmd.payload.name,
        cmd.payload.config,
        cmd.payload.commands,
      );
      return { ok: true, result: p };
    }
    if (cmd.kind === "plugin_update") {
      const { updatePluginStore } = await import("./plugins-store.server");
      const p = await updatePluginStore(cmd.payload.id, cmd.payload.patch);
      return { ok: true, result: p };
    }
    if (cmd.kind === "plugin_delete") {
      const { deletePluginStore } = await import("./plugins-store.server");
      await deletePluginStore(cmd.payload.id);
      return { ok: true, result: { ok: true } };
    }
    return { ok: false, result: { error: "unknown kind " + cmd.kind } };
  } catch (e: any) {
    return { ok: false, result: { error: String(e?.message || e) } };
  }
}

// ---------------------------------------------------------------------------
// Command transport
//
// Primary path: ONE Supabase Realtime WebSocket on `commands:<device_id>`.
// The cloud pushes the full command in the broadcast payload, so the Pi
// executes it the moment it arrives (sub-second) with zero HTTP requests while
// idle. HTTP polling is only a safety net (every 15 min, on startup and after
// a socket reconnect) so nothing is lost if a broadcast is dropped.
// ---------------------------------------------------------------------------

const HEARTBEAT_MS = 15 * 60_000;
const handled = new Set<string>();

type Cfg = { cloudUrl: string; deviceToken: string; deviceId: string };

async function postResult(cfg: Cfg, id: string, result: any) {
  await fetch(cfg.cloudUrl + "/api/public/agent/result", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.deviceToken}`,
    },
    body: JSON.stringify({ id, ...result }),
  }).catch(() => {});
}

async function runCommand(cfg: Cfg, command: any) {
  if (!command?.id || handled.has(command.id)) return;
  handled.add(command.id);
  if (handled.size > 500) handled.clear();
  console.log("[cloud-bridge] cmd", command.kind, command.id);
  const result = await execCommand(command);
  await postResult(cfg, command.id, result);
}

/** Safety net / catch-up: drain anything queued while the socket was down. */
async function drainViaPoll(cfg: Cfg) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(cfg.cloudUrl + "/api/public/agent/poll", {
      headers: { Authorization: `Bearer ${cfg.deviceToken}` },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!r || r.status === 204) return;
    if (!r.ok) {
      console.error("[cloud-bridge] poll", r.status);
      return;
    }
    const { command } = (await r.json().catch(() => ({}))) as any;
    if (!command) return;
    await runCommand(cfg, command);
  }
}

async function sendHeartbeat(cfg: Cfg) {
  const snap = await snapshot();
  if (!snap) return;
  await fetch(cfg.cloudUrl + "/api/public/agent/heartbeat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.deviceToken}`,
    },
    body: JSON.stringify(snap),
  }).catch(() => {});
}

/** One boot request: fetch the Realtime endpoint + public key for this device. */
async function fetchRealtimeConfig(cfg: Cfg) {
  const r = await fetch(cfg.cloudUrl + "/api/public/agent/realtime", {
    headers: { Authorization: `Bearer ${cfg.deviceToken}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => null)) as
    | { supabaseUrl: string; supabaseKey: string; deviceId: string; channel: string }
    | null;
}

async function loop() {
  const { getCloudConfig } = await import("./pin-store.server");
  let lastHeartbeat = 0;
  let socketDeviceId: string | null = null;
  let channel: any = null;
  let client: any = null;

  async function teardown() {
    try {
      if (client && channel) await client.removeChannel(channel);
    } catch { /* ignore */ }
    channel = null;
    socketDeviceId = null;
  }

  while (!stopRequested) {
    const raw = await getCloudConfig();
    if (!raw) {
      await teardown();
      await sleep(30_000); // not paired — stay completely quiet
      continue;
    }
    const cfg: Cfg = {
      cloudUrl: raw.cloudUrl,
      deviceToken: raw.deviceToken,
      deviceId: raw.deviceId,
    };

    try {
      // (Re)establish the WebSocket if needed.
      if (socketDeviceId !== cfg.deviceId) {
        await teardown();
        const rt = await fetchRealtimeConfig(cfg);
        if (rt) {
          const { createClient } = await import("@supabase/supabase-js");
          client = createClient(rt.supabaseUrl, rt.supabaseKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          channel = client
            .channel(rt.channel)
            .on("broadcast", { event: "wake" }, ({ payload }: any) => {
              const command = payload?.command;
              if (command?.id) {
                void runCommand(cfg, command).catch((e) =>
                  console.error("[cloud-bridge] exec", e?.message || e),
                );
              } else {
                // Bare wake (oversized payload): fetch it over HTTP.
                void drainViaPoll(cfg).catch(() => {});
              }
            })
            .subscribe((status: string) => {
              console.log("[cloud-bridge] realtime", status);
              if (status === "SUBSCRIBED") {
                socketDeviceId = cfg.deviceId;
                void drainViaPoll(cfg).catch(() => {}); // catch-up
              }
              if (status === "CHANNEL_ERROR" || status === "CLOSED" || status === "TIMED_OUT") {
                socketDeviceId = null; // next tick re-subscribes + catches up
              }
            });
        } else {
          console.warn("[cloud-bridge] realtime config unavailable — HTTP safety net only");
          await drainViaPoll(cfg);
        }
      }

      const now = Date.now();
      if (now - lastHeartbeat > HEARTBEAT_MS) {
        lastHeartbeat = now;
        await sendHeartbeat(cfg);
        // Safety net: one drain per heartbeat window (~1 request / 15 min),
        // in case a broadcast was dropped while we were connected.
        await drainViaPoll(cfg);
      }
    } catch (e: any) {
      console.error("[cloud-bridge]", e?.message || e);
    }

    // Idle tick: no HTTP traffic happens here — the socket does the work.
    await sleep(socketDeviceId ? 60_000 : 15_000);
  }
  await teardown();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function ensureCloudBridgeStarted() {
  if (started) return;
  started = true;
  console.log("[cloud-bridge] started");
  loop().catch((e) => {
    console.error("[cloud-bridge] crashed", e);
    started = false;
  });
}

export function stopCloudBridge() {
  stopRequested = true;
  started = false;
}
