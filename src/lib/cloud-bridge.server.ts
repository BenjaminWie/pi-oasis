// In-process cloud bridge running on the Pi. When ~/.pi-hub/state.json
// contains a `cloud` section, long-polls the cloud relay and executes
// agent_commands locally (docker / mqtt / status / terminal).
// Auto-starts once the first server fn calls `isPiRuntime()`.

let started = false;
let stopRequested = false;

async function snapshot() {
  try {
    const { readRealSystemStats, listRealContainers } = await import("./system.server");
    const [stats, containers] = await Promise.all([
      readRealSystemStats(),
      listRealContainers().catch(() => []),
    ]);
    return {
      cpu: stats.cpu,
      ram: stats.ramTotalGb ? (stats.ramUsedGb / stats.ramTotalGb) * 100 : null,
      temp: stats.tempC,
      disk: stats.diskUsedPct,
      uptime: stats.uptime,
      containers: containers.map((c) => ({
        name: c.name,
        status: c.status === "running" ? "running" : c.status,
        image: c.image,
      })),
      mqtt_brokers: containers.filter((c) => c.isMqtt).map((c) => c.name),
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
        simulated: plugin.config.simulated,
      });
      return { ok: true, result: { ok: true, action, minutes } };
    }
    return { ok: false, result: { error: "unknown kind " + cmd.kind } };
  } catch (e: any) {
    return { ok: false, result: { error: String(e?.message || e) } };
  }
}

async function loop() {
  const { getCloudConfig } = await import("./pin-store.server");
  let lastHeartbeat = 0;

  while (!stopRequested) {
    const cfg = await getCloudConfig();
    if (!cfg) {
      await sleep(5000);
      continue;
    }
    try {
      const now = Date.now();
      if (now - lastHeartbeat > 30_000) {
        lastHeartbeat = now;
        const snap = await snapshot();
        if (snap) {
          await fetch(cfg.cloudUrl + "/api/public/agent/heartbeat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${cfg.deviceToken}`,
            },
            body: JSON.stringify(snap),
          }).catch(() => {});
        }
      }

      const r = await fetch(cfg.cloudUrl + "/api/public/agent/poll", {
        headers: { Authorization: `Bearer ${cfg.deviceToken}` },
        signal: AbortSignal.timeout(35_000),
      });
      if (r.status === 204) continue;
      if (!r.ok) {
        console.error("[cloud-bridge] poll", r.status);
        await sleep(5000);
        continue;
      }
      const { command } = (await r.json()) as any;
      if (!command) continue;
      console.log("[cloud-bridge] cmd", command.kind, command.id);
      const result = await execCommand(command);
      await fetch(cfg.cloudUrl + "/api/public/agent/result", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.deviceToken}`,
        },
        body: JSON.stringify({ id: command.id, ...result }),
      }).catch(() => {});
    } catch (e: any) {
      console.error("[cloud-bridge]", e?.message || e);
      await sleep(5000);
    }
  }
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
