// 60s tick loop that evaluates each enabled plugin against its current AI
// plan + manual overrides, then publishes MQTT (or toggles sim state).

let started = false;
let stopRequested = false;
const lastRunByPlugin = new Map<string, number>();
const minutesUsedTodayByPlugin = new Map<string, { dayKey: string; minutes: number }>();

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function ensurePlan(pluginId: string) {
  const { getPlanStore, getPluginStore, setPlanStore } = await import("./plugins-store.server");
  const p = await getPlanStore(pluginId);
  if (p && new Date(p.validUntil).getTime() > Date.now()) return p;
  const plugin = await getPluginStore(pluginId);
  if (!plugin) return null;
  const { buildPlan } = await import("./ai-planner.server");
  const fresh = await buildPlan(plugin).catch((e) => {
    console.error("[plugin-runner] plan build failed", e);
    return null;
  });
  if (fresh) await setPlanStore(fresh);
  return fresh;
}

async function applyAction(
  pluginId: string,
  action: "on" | "off",
  simulated: boolean,
  cfg: { brokerId: string | null; cmndTopic: string },
) {
  const { setSimStateStore } = await import("./plugins-store.server");
  if (simulated || !cfg.brokerId) {
    await setSimStateStore(pluginId, action === "on");
    return;
  }
  try {
    const { publishMqtt } = await import("./mqtt.server");
    await publishMqtt(cfg.brokerId, {
      topic: cfg.cmndTopic,
      payload: action === "on" ? "ON" : "OFF",
      qos: 0,
      retained: false,
    });
  } catch (e) {
    console.error("[plugin-runner] mqtt publish failed", e);
    // mirror to sim so UI still reflects intent
    await setSimStateStore(pluginId, action === "on");
  }
}

async function tickPlugin(pluginId: string) {
  const { getPluginStore, takeOverrideStore, recordDecisionStore, getSimStateStore } =
    await import("./plugins-store.server");
  const plugin = await getPluginStore(pluginId);
  if (!plugin || !plugin.enabled) return;

  // 1) Honor manual override first
  const override = await takeOverrideStore(pluginId);
  if (override) {
    await applyAction(pluginId, override.action, (plugin.config as any).simulated, plugin.config as any);
    return; // decision row was already written when the override was queued
  }

  // 2) Get an active plan
  const plan = await ensurePlan(pluginId);
  if (!plan) return;

  const now = Date.now();
  const inWindow = plan.windows.find(
    (w) => new Date(w.startIso).getTime() <= now && now < new Date(w.endIso).getTime(),
  );
  const current = await getSimStateStore(pluginId);
  const currentlyOn = !!current?.on;

  // daily cap
  const used = minutesUsedTodayByPlugin.get(pluginId);
  const today = dayKey();
  const usedMin = used && used.dayKey === today ? used.minutes : 0;
  const overCap = usedMin >= plugin.config.maxMinutesPerDay;

  // min hours between runs
  const lastRun = lastRunByPlugin.get(pluginId) ?? 0;
  const hoursSinceLast = (now - lastRun) / 3600_000;
  const tooSoon = lastRun > 0 && hoursSinceLast < plugin.config.minHoursBetweenRuns;

  let action: "on" | "off" | "skip" = "skip";
  let reason = "No active window.";
  if (inWindow) {
    if (overCap) {
      action = currentlyOn ? "off" : "skip";
      reason = `Daily cap reached (${plugin.config.maxMinutesPerDay}m).`;
    } else if (tooSoon) {
      action = currentlyOn ? "off" : "skip";
      reason = `Min ${plugin.config.minHoursBetweenRuns}h between runs (last ${hoursSinceLast.toFixed(1)}h ago).`;
    } else {
      action = "on";
      reason = `In window — ${plan.rationale}`;
    }
  } else if (currentlyOn) {
    action = "off";
    reason = "Window closed.";
  }

  if (action !== "skip") {
    await applyAction(pluginId, action, (plugin.config as any).simulated, plugin.config as any);
    if (action === "on") {
      lastRunByPlugin.set(pluginId, now);
      // accumulate ~1 minute per tick we're on
      minutesUsedTodayByPlugin.set(pluginId, {
        dayKey: today,
        minutes: usedMin + 1,
      });
    }
  }
  await recordDecisionStore({
    pluginId,
    action,
    reason,
    simulated: plugin.config.simulated,
    inputs: {
      planSource: plan.source,
      inWindow: !!inWindow,
      currentlyOn,
      usedMinutesToday: usedMin,
      hoursSinceLastRun: Math.round(hoursSinceLast * 10) / 10,
    },
  });
}

async function loop() {
  const { listPluginsStore } = await import("./plugins-store.server");
  while (!stopRequested) {
    try {
      const plugins = await listPluginsStore();
      for (const p of plugins) {
        if (!p.enabled) continue;
        await tickPlugin(p.id).catch((e) => console.error("[plugin-runner] tick failed", p.id, e));
      }
    } catch (e) {
      console.error("[plugin-runner] loop error", e);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

export function ensurePluginRunnerStarted() {
  if (started) return;
  started = true;
  console.log("[plugin-runner] started");
  loop().catch((e) => {
    console.error("[plugin-runner] crashed", e);
    started = false;
  });
}
