// Pi Control — endpoint registry. Server-only, no database.
//
// Node-RED announces its own endpoints (POST /api/public/nodered/announce) and
// pushes values (POST /api/public/nodered/value). Everything lives in memory;
// only the user's per-endpoint tuning is persisted as a small JSON file so it
// survives a restart.
//
// This is the single source of truth for:
//   * the local Control / Tuning / Debug tabs
//   * the cloud relay (/api/public/pi/endpoints, /api/public/pi/invoke)
//   * Alexa / Telegram / AI (they only ever see what is exposed here)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { publishLocalBus } from "./local-live-bus.server";

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type EndpointKind = "read" | "switch" | "number" | "action";

export interface EndpointInvoke {
  /** Node-RED http-in URL that performs the action. */
  url?: string;
  method?: "GET" | "POST";
  /** Alternative: publish to this MQTT topic (broker auto-detected). */
  mqttTopic?: string;
  mqttBrokerId?: string;
  /** payloads for switch endpoints (default "ON"/"OFF") */
  mqttPayloadOn?: string;
  mqttPayloadOff?: string;
}

export interface AnnouncedEndpoint {
  id: string;
  label?: string;
  kind?: EndpointKind;
  unit?: string;
  min?: number;
  max?: number;
  options?: string[];
  group?: string;
  invoke?: EndpointInvoke;
  description?: string;
}

export interface EndpointConfig {
  label?: string;
  unit?: string;
  min?: number;
  max?: number;
  /** visible to Alexa / Telegram / AI */
  voice?: boolean;
  /** may be switched / written */
  control?: boolean;
  /** hidden in the local Control tab */
  hidden?: boolean;
}

export interface Endpoint extends AnnouncedEndpoint {
  kind: EndpointKind;
  /** who announced it — "nodered", "pi-control", … */
  source?: string;
  announcedAt: string;
  lastSeenAt: string;
  value?: Json;
  valueAt?: string;
  config: EndpointConfig;
  /** resolved flags after applying config */
  voice: boolean;
  control: boolean;
}

// ------------------------------------------------------------------- storage
function homeDir(): string {
  return process.env.PI_CONTROL_HOME || process.env.PI_HUB_HOME || join(homedir(), ".pi-control");
}

const CONFIG_FILE = join(homeDir(), "endpoints.json");

let configs: Record<string, EndpointConfig> = {};
let configLoaded = false;

function loadConfigs() {
  if (configLoaded) return;
  configLoaded = true;
  try {
    if (existsSync(CONFIG_FILE)) {
      configs = JSON.parse(readFileSync(CONFIG_FILE, "utf8")) as Record<string, EndpointConfig>;
    }
  } catch {
    configs = {};
  }
}

function persistConfigs() {
  try {
    const dir = homeDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), { mode: 0o600 });
  } catch (e) {
    debugLog("error", "config_persist_failed", { error: String(e) });
  }
}

// -------------------------------------------------------------- debug buffer
export type DebugChannel = "node-red" | "alexa" | "telegram" | "chat" | "rules" | "local";

export const DEBUG_CHANNELS: DebugChannel[] = [
  "node-red",
  "alexa",
  "telegram",
  "chat",
  "rules",
  "local",
];

export function asChannel(via?: string | null): DebugChannel {
  const v = (via ?? "").toLowerCase();
  if (v.includes("alexa")) return "alexa";
  if (v.includes("telegram")) return "telegram";
  if (v.includes("chat") || v.includes("brain") || v.includes("assistant")) return "chat";
  if (v.includes("rule") || v.includes("regel") || v.includes("planner")) return "rules";
  if (v.includes("node") || v.includes("nodered")) return "node-red";
  return "local";
}

export interface DebugEntry {
  ts: string;
  dir: "in" | "out" | "error" | "info";
  channel: DebugChannel;
  what: string;
  detail?: Json;
  /** ms the request took, when known */
  ms?: number;
}

const DEBUG_MAX = Math.max(50, Number(process.env.PI_CONTROL_DEBUG_MAX ?? 400));
const debugRing: DebugEntry[] = [];

// Verbose logging (raw payloads) is opt-in per channel and survives restarts.
const SETTINGS_FILE = join(homeDir(), "debug.json");
let verbose: Partial<Record<DebugChannel, boolean>> = {};
let verboseLoaded = false;

function loadVerbose() {
  if (verboseLoaded) return;
  verboseLoaded = true;
  try {
    if (existsSync(SETTINGS_FILE)) {
      verbose = JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as typeof verbose;
    }
  } catch {
    verbose = {};
  }
}

export function debugSettings(): Record<DebugChannel, boolean> {
  loadVerbose();
  return Object.fromEntries(DEBUG_CHANNELS.map((c) => [c, Boolean(verbose[c])])) as Record<
    DebugChannel,
    boolean
  >;
}

export function setDebugVerbose(channel: DebugChannel, on: boolean) {
  loadVerbose();
  verbose[channel] = on;
  try {
    const dir = homeDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(SETTINGS_FILE, JSON.stringify(verbose, null, 2), { mode: 0o600 });
  } catch {
    /* best effort */
  }
  debugLog("info", `ausführliches Protokoll ${on ? "an" : "aus"}: ${channel}`, undefined, channel);
  return debugSettings();
}

export function isVerbose(channel: DebugChannel): boolean {
  loadVerbose();
  return Boolean(verbose[channel]);
}

export function debugLog(
  dir: DebugEntry["dir"],
  what: string,
  detail?: unknown,
  channel: DebugChannel = "local",
  ms?: number,
) {
  let safe: Json | undefined;
  try {
    safe = detail === undefined ? undefined : (JSON.parse(JSON.stringify(detail ?? null)) as Json);
  } catch {
    safe = String(detail) as Json;
  }
  const entry: DebugEntry = { ts: new Date().toISOString(), dir, channel, what, detail: safe };
  if (Number.isFinite(ms)) entry.ms = Math.round(ms as number);
  debugRing.push(entry);
  if (debugRing.length > DEBUG_MAX) debugRing.splice(0, debugRing.length - DEBUG_MAX);
  try {
    publishLocalBus("trace", entry);
  } catch {
    /* best effort */
  }
}

/** Only recorded while the channel's verbose switch is on (raw payloads). */
export function debugLogVerbose(
  dir: DebugEntry["dir"],
  what: string,
  detail: unknown,
  channel: DebugChannel,
) {
  if (!isVerbose(channel)) return;
  debugLog(dir, what, detail, channel);
}

export function debugEntries(limit = 200): DebugEntry[] {
  return debugRing.slice(-Math.max(1, limit)).reverse();
}

// ------------------------------------------------------------------ registry
const endpoints = new Map<string, Endpoint>();
let lastAnnounceAt: string | null = null;
let noderedSource: string | null = null;

function defaultsFor(kind: EndpointKind) {
  return { voice: true, control: kind !== "read" };
}

function decorate(e: Endpoint): Endpoint {
  const cfg = { ...(configs[e.id] ?? {}) };
  const d = defaultsFor(e.kind);
  return {
    ...e,
    config: cfg,
    label: cfg.label || e.label || e.id,
    unit: cfg.unit ?? e.unit,
    min: cfg.min ?? e.min,
    max: cfg.max ?? e.max,
    voice: cfg.voice ?? d.voice,
    control: (cfg.control ?? d.control) && e.kind !== "read",
  };
}

const idRe = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** Node-RED self-announce. Replaces the set of endpoints coming from `source`. */
export function announceEndpoints(
  list: AnnouncedEndpoint[],
  meta: { source?: string; replace?: boolean } = {},
): { accepted: number; rejected: string[]; total: number } {
  loadConfigs();
  const now = new Date().toISOString();
  const source = meta.source ?? "nodered";
  noderedSource = source;
  lastAnnounceAt = now;

  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const raw of list) {
    if (!raw?.id || !idRe.test(raw.id)) {
      rejected.push(String(raw?.id ?? "?"));
      continue;
    }
    const id = raw.id.toLowerCase();
    seen.add(id);
    const prev = endpoints.get(id);
    const kind: EndpointKind = raw.kind ?? prev?.kind ?? "read";
    endpoints.set(id, {
      ...raw,
      id,
      kind,
      group: raw.group ?? prev?.group,
      source,
      announcedAt: prev?.announcedAt ?? now,
      lastSeenAt: now,
      value: prev?.value,
      valueAt: prev?.valueAt,
      config: {},
      voice: true,
      control: kind !== "read",
    });
  }

  if (meta.replace !== false) {
    // only prune what the SAME source announced before
    for (const [id, e] of endpoints) {
      if (!seen.has(id) && (e.source ?? "nodered") === source) endpoints.delete(id);
    }
  }

  debugLog("in", `announce (${seen.size} endpoints)`, { source, rejected }, "node-red");
  return { accepted: seen.size, rejected, total: endpoints.size };
}

export function listEndpoints(): Endpoint[] {
  loadConfigs();
  return [...endpoints.values()].map(decorate).sort((a, b) => a.id.localeCompare(b.id));
}

export function getEndpoint(id: string): Endpoint | null {
  loadConfigs();
  const e = endpoints.get(id.toLowerCase());
  return e ? decorate(e) : null;
}

export function registryInfo() {
  return {
    count: endpoints.size,
    lastAnnounceAt,
    source: noderedSource,
    configFile: CONFIG_FILE,
  };
}

/** Node-RED pushes a value for an announced (or new) endpoint. */
export function setEndpointValue(id: string, value: unknown): boolean {
  const v = (value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json));
  loadConfigs();
  const key = id.toLowerCase();
  const now = new Date().toISOString();
  const prev = endpoints.get(key);
  if (!prev) {
    if (!idRe.test(key)) return false;
    endpoints.set(key, {
      id: key,
      kind: "read",
      announcedAt: now,
      lastSeenAt: now,
      value: v,
      valueAt: now,
      config: {},
      voice: true,
      control: false,
    });
  } else {
    prev.value = v;
    prev.valueAt = now;
    prev.lastSeenAt = now;
  }
  publishLocalBus("tick", { endpoint: key, value: v, ts: now });
  return true;
}

export function setEndpointConfig(id: string, patch: EndpointConfig) {
  loadConfigs();
  const key = id.toLowerCase();
  configs[key] = { ...(configs[key] ?? {}), ...patch };
  for (const k of Object.keys(configs[key]) as (keyof EndpointConfig)[]) {
    if (configs[key][k] === null || configs[key][k] === undefined) delete configs[key][k];
  }
  persistConfigs();
  debugLog("info", `tuning saved: ${key}`, patch);
  return getEndpoint(key);
}

// -------------------------------------------------------------------- invoke
export interface InvokeResult {
  ok: boolean;
  id: string;
  value?: Json;
  status?: number;
  result?: Json;
  error?: string;
}

const TIMEOUT_MS = Math.max(1_000, Number(process.env.PI_CONTROL_INVOKE_TIMEOUT_MS ?? 8_000));

/**
 * Execute an endpoint. `force` bypasses the user's control flag (used by the
 * Debug tab's test shot, never by voice).
 */
export async function invokeEndpoint(
  id: string,
  value: Json,
  opts: { force?: boolean; via?: string } = {},
): Promise<InvokeResult> {
  const e = getEndpoint(id);
  if (!e) return { ok: false, id, error: "unknown_endpoint" };
  if (e.kind === "read") return { ok: false, id, error: "read_only" };
  if (!e.control && !opts.force) return { ok: false, id, error: "control_disabled" };

  const payload = { id: e.id, value, ts: new Date().toISOString(), via: opts.via ?? "local" };
  const ch = asChannel(opts.via);
  debugLog("out", `invoke ${e.id}`, payload, ch);

  const inv = e.invoke ?? {};
  try {
    if (inv.url) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const method = inv.method ?? "POST";
        const url =
          method === "GET"
            ? `${inv.url}${inv.url.includes("?") ? "&" : "?"}value=${encodeURIComponent(String(value))}`
            : inv.url;
        const res = await fetch(url, {
          method,
          signal: ctrl.signal,
          headers: { "content-type": "application/json" },
          body: method === "POST" ? JSON.stringify(payload) : undefined,
        });
        const body = await res.text();
        let parsed: Json = body;
        try {
          parsed = JSON.parse(body) as Json;
        } catch {
          /* plain text is fine */
        }
        const out: InvokeResult = { ok: res.ok, id: e.id, value, status: res.status, result: parsed };
        if (!res.ok) out.error = `nodered_http_${res.status}`;
        debugLog(res.ok ? "in" : "error", `invoke result ${e.id}`, out, ch);
        if (res.ok) setEndpointValue(e.id, value);
        return out;
      } finally {
        clearTimeout(t);
      }
    }

    if (inv.mqttTopic) {
      const { publishMqtt } = await import("./mqtt.server");
      const { listRealContainers } = await import("./system.server");
      let brokerId = inv.mqttBrokerId;
      if (!brokerId) {
        const containers = await listRealContainers().catch(() => []);
        brokerId = containers.find((c) => /mosquitto|mqtt|broker/i.test(c.name))?.id;
      }
      if (!brokerId) return { ok: false, id: e.id, error: "no_mqtt_broker" };
      const isBool = typeof value === "boolean";
      const payloadStr = isBool
        ? value
          ? (inv.mqttPayloadOn ?? "ON")
          : (inv.mqttPayloadOff ?? "OFF")
        : typeof value === "string"
          ? value
          : JSON.stringify(value);
      await publishMqtt(brokerId, {
        topic: inv.mqttTopic,
        payload: payloadStr,
        qos: 0,
        retained: false,
      });
      debugLog("out", `mqtt ${inv.mqttTopic}`, { payload: payloadStr }, ch);
      setEndpointValue(e.id, value);
      return { ok: true, id: e.id, value, result: { published: inv.mqttTopic } };
    }

    return { ok: false, id: e.id, error: "no_invoke_target" };
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    debugLog("error", `invoke failed ${e.id}`, { error: msg }, ch);
    return { ok: false, id: e.id, error: msg.includes("abort") ? "nodered_timeout" : msg };
  }
}

/** Compact snapshot handed to the cloud, Alexa, Telegram and the AI. */
export function voiceSnapshot() {
  return listEndpoints()
    .filter((e) => e.voice)
    .map((e) => ({
      id: e.id,
      label: e.label,
      kind: e.kind,
      unit: e.unit,
      value: e.value ?? null,
      valueAt: e.valueAt ?? null,
      control: e.control,
      options: e.options,
      min: e.min,
      max: e.max,
      description: e.description,
    }));
}
