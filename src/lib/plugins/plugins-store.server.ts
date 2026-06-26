// Pi-local plugin store. Lives at ~/.pi-hub/plugins.json. Server-only.
// Holds plugin definitions, the latest AI plan per plugin, and a ring
// buffer of recent decisions (so the timeline survives restarts).

import { promises as fs, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const DIR = process.env.PI_HUB_HOME || join(homedir(), ".pi-hub");
const FILE = join(DIR, "plugins.json");
const MAX_DECISIONS = 200;

export type PluginKind = "smart_pump";

export interface SmartPumpConfig {
  brokerId: string | null; // mqtt broker container id; null when simulated
  cmndTopic: string; // e.g. cmnd/tasmota_pump/POWER
  statTopic: string; // e.g. stat/tasmota_pump/POWER
  lat: number;
  lon: number;
  maxMinutesPerDay: number;
  minHoursBetweenRuns: number;
  runMinutes: number; // duration of one watering cycle
  simulated: boolean;
}

export interface Plugin {
  id: string;
  kind: PluginKind;
  name: string;
  enabled: boolean;
  createdAt: string;
  config: SmartPumpConfig;
}

export interface PluginPlan {
  pluginId: string;
  createdAt: string;
  validUntil: string;
  rationale: string;
  // Windows (UTC ISO) in which it's OK to run today + abort conditions
  windows: Array<{ startIso: string; endIso: string }>;
  abortIfRainMmNext6h?: number;
  source: "ai" | "fallback";
}

export type DecisionAction = "on" | "off" | "skip" | "manual_on" | "manual_off";

export type DecisionInputs = Record<string, string | number | boolean | null>;

export interface PluginDecision {
  id: string;
  pluginId: string;
  decidedAt: string;
  action: DecisionAction;
  reason: string;
  simulated: boolean;
  inputs?: DecisionInputs;
}

export interface ManualOverride {
  pluginId: string;
  action: "on" | "off";
  validUntilIso: string;
  consumed: boolean;
}

interface FileShape {
  plugins: Plugin[];
  plans: Record<string, PluginPlan | undefined>;
  decisions: PluginDecision[];
  overrides: ManualOverride[];
  // ephemeral simulated plug state, persisted so the UI keeps showing it
  simStates: Record<string, { on: boolean; sinceIso: string }>;
}

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

async function load(): Promise<FileShape> {
  ensureDir();
  if (!existsSync(FILE)) {
    return { plugins: [], plans: {}, decisions: [], overrides: [], simStates: {} };
  }
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const j = JSON.parse(raw) as Partial<FileShape>;
    return {
      plugins: j.plugins ?? [],
      plans: j.plans ?? {},
      decisions: j.decisions ?? [],
      overrides: j.overrides ?? [],
      simStates: j.simStates ?? {},
    };
  } catch {
    return { plugins: [], plans: {}, decisions: [], overrides: [], simStates: {} };
  }
}

async function save(s: FileShape) {
  ensureDir();
  await fs.writeFile(FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export async function listPluginsStore(): Promise<Plugin[]> {
  return (await load()).plugins;
}

export async function getPluginStore(id: string): Promise<Plugin | null> {
  return (await load()).plugins.find((p) => p.id === id) ?? null;
}

export async function createPluginStore(
  kind: PluginKind,
  name: string,
  config: SmartPumpConfig,
): Promise<Plugin> {
  const s = await load();
  const p: Plugin = {
    id: randomBytes(6).toString("hex"),
    kind,
    name,
    enabled: true,
    createdAt: new Date().toISOString(),
    config,
  };
  s.plugins.unshift(p);
  await save(s);
  return p;
}

export async function updatePluginStore(
  id: string,
  patch: Partial<Pick<Plugin, "name" | "enabled" | "config">>,
): Promise<Plugin | null> {
  const s = await load();
  const i = s.plugins.findIndex((p) => p.id === id);
  if (i < 0) return null;
  s.plugins[i] = {
    ...s.plugins[i],
    ...patch,
    config: patch.config ? { ...s.plugins[i].config, ...patch.config } : s.plugins[i].config,
  };
  await save(s);
  return s.plugins[i];
}

export async function deletePluginStore(id: string): Promise<void> {
  const s = await load();
  s.plugins = s.plugins.filter((p) => p.id !== id);
  delete s.plans[id];
  s.decisions = s.decisions.filter((d) => d.pluginId !== id);
  s.overrides = s.overrides.filter((o) => o.pluginId !== id);
  delete s.simStates[id];
  await save(s);
}

export async function setPlanStore(plan: PluginPlan): Promise<void> {
  const s = await load();
  s.plans[plan.pluginId] = plan;
  await save(s);
}

export async function getPlanStore(pluginId: string): Promise<PluginPlan | null> {
  return (await load()).plans[pluginId] ?? null;
}

export async function recordDecisionStore(
  d: Omit<PluginDecision, "id" | "decidedAt"> & { decidedAt?: string },
): Promise<PluginDecision> {
  const s = await load();
  const dec: PluginDecision = {
    id: randomBytes(6).toString("hex"),
    decidedAt: d.decidedAt ?? new Date().toISOString(),
    pluginId: d.pluginId,
    action: d.action,
    reason: d.reason,
    simulated: d.simulated,
    inputs: d.inputs,
  };
  s.decisions.unshift(dec);
  if (s.decisions.length > MAX_DECISIONS) s.decisions.length = MAX_DECISIONS;
  await save(s);
  return dec;
}

export async function listDecisionsStore(pluginId: string, limit = 50): Promise<PluginDecision[]> {
  const s = await load();
  return s.decisions.filter((d) => d.pluginId === pluginId).slice(0, limit);
}

export async function queueOverrideStore(o: ManualOverride): Promise<void> {
  const s = await load();
  s.overrides = s.overrides.filter((x) => x.pluginId !== o.pluginId || x.consumed);
  s.overrides.unshift(o);
  // keep last 50
  s.overrides = s.overrides.slice(0, 50);
  await save(s);
}

export async function takeOverrideStore(pluginId: string): Promise<ManualOverride | null> {
  const s = await load();
  const o = s.overrides.find(
    (x) =>
      x.pluginId === pluginId && !x.consumed && new Date(x.validUntilIso).getTime() > Date.now(),
  );
  if (!o) return null;
  o.consumed = true;
  await save(s);
  return o;
}

export async function setSimStateStore(pluginId: string, on: boolean): Promise<void> {
  const s = await load();
  s.simStates[pluginId] = { on, sinceIso: new Date().toISOString() };
  await save(s);
}

export async function getSimStateStore(
  pluginId: string,
): Promise<{ on: boolean; sinceIso: string } | null> {
  return (await load()).simStates[pluginId] ?? null;
}
