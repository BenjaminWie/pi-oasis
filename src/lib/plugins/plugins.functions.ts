// Server functions for the plugin system. All gated by requirePiAuth.

import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "../auth/pi-auth-middleware";
import type { Plugin, PluginDecision, PluginPlan, SmartPumpConfig } from "./plugins-store.server";

function validateConfig(c: Partial<SmartPumpConfig>): SmartPumpConfig {
  const cmndTopic = String(c.cmndTopic ?? "").trim();
  const statTopic = String(c.statTopic ?? "").trim();
  if (!/^[a-zA-Z0-9_\-/+#]{1,200}$/.test(cmndTopic)) throw new Error("invalid cmnd topic");
  if (!/^[a-zA-Z0-9_\-/+#]{1,200}$/.test(statTopic)) throw new Error("invalid stat topic");
  const lat = Number(c.lat);
  const lon = Number(c.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error("invalid lat");
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error("invalid lon");
  const runMinutes = Math.max(1, Math.min(120, Number(c.runMinutes) || 10));
  const maxMinutesPerDay = Math.max(1, Math.min(480, Number(c.maxMinutesPerDay) || 30));
  const minHoursBetweenRuns = Math.max(0, Math.min(48, Number(c.minHoursBetweenRuns) || 12));
  return {
    brokerId: typeof c.brokerId === "string" && c.brokerId.length ? c.brokerId : null,
    cmndTopic,
    statTopic,
    lat,
    lon,
    maxMinutesPerDay,
    minHoursBetweenRuns,
    runMinutes,
    simulated: c.simulated !== false,
  };
}

export const listPlugins = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async (): Promise<{ plugins: Plugin[] }> => {
    const { listPluginsStore } = await import("@/lib/plugins/plugins-store.server");
    return { plugins: await listPluginsStore() };
  });

export const getPlugin = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(
    async ({
      data,
    }): Promise<{
      plugin: Plugin | null;
      plan: PluginPlan | null;
      decisions: PluginDecision[];
      simState: { on: boolean; sinceIso: string } | null;
    }> => {
      const { getPluginStore, getPlanStore, listDecisionsStore, getSimStateStore } =
        await import("../plugins/plugins-store.server");
      const plugin = await getPluginStore(data.id);
      if (!plugin) return { plugin: null, plan: null, decisions: [], simState: null };
      const [plan, decisions, simState] = await Promise.all([
        getPlanStore(data.id),
        listDecisionsStore(data.id, 100),
        getSimStateStore(data.id),
      ]);
      return { plugin, plan, decisions, simState };
    },
  );

export const createSmartPump = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: { name?: string; config: Partial<SmartPumpConfig> }) => d)
  .handler(async ({ data }) => {
    const { createPluginStore } = await import("@/lib/plugins/plugins-store.server");
    const config = validateConfig(data.config);
    const name = (data.name || "Smart Pump").slice(0, 64);
    const p = await createPluginStore("smart_pump", name, config);
    return { plugin: p };
  });

export const updatePlugin = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator(
    (d: { id: string; name?: string; enabled?: boolean; config?: Partial<SmartPumpConfig> }) => d,
  )
  .handler(async ({ data }) => {
    const { updatePluginStore } = await import("@/lib/plugins/plugins-store.server");
    const patch: any = {};
    if (data.name != null) patch.name = String(data.name).slice(0, 64);
    if (data.enabled != null) patch.enabled = !!data.enabled;
    if (data.config) patch.config = validateConfig(data.config);
    const p = await updatePluginStore(data.id, patch);
    return { plugin: p };
  });

export const deletePlugin = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { deletePluginStore } = await import("@/lib/plugins/plugins-store.server");
    await deletePluginStore(data.id);
    return { ok: true };
  });

export const runPlannerNow = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data }) => {
    const { getPluginStore, setPlanStore } = await import("@/lib/plugins/plugins-store.server");
    const plugin = await getPluginStore(data.id);
    if (!plugin) return { ok: false as const, error: "plugin not found" };
    const { buildPlan } = await import("@/lib/ai/ai-planner.server");
    const plan = await buildPlan(plugin);
    await setPlanStore(plan);
    return { ok: true as const, plan };
  });

export const manualAction = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: { id: string; action: "on" | "off"; minutes?: number }) => {
    if (d.action !== "on" && d.action !== "off") throw new Error("invalid action");
    return d;
  })
  .handler(async ({ data }) => {
    const { queueOverrideStore, recordDecisionStore, getPluginStore } =
      await import("../plugins/plugins-store.server");
    const plugin = await getPluginStore(data.id);
    if (!plugin) return { ok: false as const, error: "plugin not found" };
    const minutes = Math.max(1, Math.min(120, Number(data.minutes) || 10));
    await queueOverrideStore({
      pluginId: data.id,
      action: data.action,
      validUntilIso: new Date(Date.now() + minutes * 60_000).toISOString(),
      consumed: false,
    });
    await recordDecisionStore({
      pluginId: data.id,
      action: data.action === "on" ? "manual_on" : "manual_off",
      reason: `Manual override — ${data.action.toUpperCase()} for ${minutes}m`,
      simulated: plugin.config.simulated,
    });
    return { ok: true as const };
  });
