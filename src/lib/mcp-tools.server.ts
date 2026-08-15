// MCP tool registry + executor — DATABASE-FREE.
//
// Every tool talks to the Pi through the relay (src/lib/pi-relay.server.ts):
// reads hit the Pi's local 48h store, controls are executed synchronously on
// the device. No Supabase, no command queue, no audit table.
//
// Server-only. Load from inside a handler, never at route module scope.

import { z } from "zod";
import {
  describeAge,
  getPiState,
  relayCommand,
  relayGet,
  piConfig,
} from "@/lib/pi-relay.server";
import { verifyToken } from "@/lib/stateless-token.server";

export type Scope = "read" | "control";

export interface ToolCtx {
  userId: string;
  deviceId: string;
  scopes: Scope[];
  tokenId: string;
}

export interface ToolDef {
  name: string;
  description: string;
  scope: Scope;
  inputSchema: z.ZodTypeAny;
  execute: (args: any, ctx: ToolCtx) => Promise<unknown>;
}

// ---- helpers ---------------------------------------------------------------

async function run(kind: string, payload: Record<string, unknown> = {}) {
  const out = await relayCommand(kind, payload);
  if (!out.ok) return { ok: false, result: null, error: out.error ?? "pi_offline" };
  return { ok: true, result: out.result };
}

interface TsRow {
  ts?: string;
  component?: string;
  status?: string;
  metrics?: Record<string, any>;
  [k: string]: unknown;
}

async function history(
  kind: "tick" | "event",
  minutes: number,
  component?: string,
): Promise<TsRow[]> {
  const q = new URLSearchParams({ kind, minutes: String(minutes) });
  if (component) q.set("component", component);
  const r = await relayGet<{ rows: TsRow[] }>(
    `/api/public/pi/history?${q.toString()}`,
    `hist:${kind}:${minutes}:${component ?? ""}`,
  );
  return r.data?.rows ?? [];
}

function wattsOf(row: TsRow): number | null {
  const v = row.metrics?.watts ?? (row as any).watts ?? row.metrics?.watt;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- tool defs -------------------------------------------------------------

export const TOOLS: ToolDef[] = [
  {
    name: "get_device_info",
    description:
      "Get the Pi's last known state (pump, energy, CPU, RAM, temperature, disk) plus how fresh that reading is. Cheap — no round-trip when the cached value is fresh.",
    scope: "read",
    inputSchema: z.object({}),
    async execute() {
      const r = await getPiState();
      return {
        available: Boolean(r.data),
        stale: r.stale,
        age: describeAge(r.ageSec),
        state: r.data,
        error: r.error,
      };
    },
  },
  {
    name: "get_status",
    description:
      "Fetch a fresh system status from the Pi (CPU, RAM, temperature, disk, uptime, container list, MQTT brokers).",
    scope: "read",
    inputSchema: z.object({}),
    async execute() {
      const r = await run("status");
      if (r.ok) return r;
      // Fall back to the cached state so voice channels still say something useful.
      const s = await getPiState();
      return { ok: Boolean(s.data), result: s.data, stale: s.stale, error: r.error };
    },
  },
  {
    name: "list_containers",
    description: "List Docker containers currently running on the Pi.",
    scope: "read",
    inputSchema: z.object({}),
    async execute() {
      const r = await run("status");
      const snap: any = r.result;
      return { containers: snap?.containers ?? [] };
    },
  },
  {
    name: "container_action",
    description:
      "Start, stop, or restart a Docker container on the Pi by name. Requires the 'control' scope.",
    scope: "control",
    inputSchema: z.object({
      name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.\-]+$/),
      action: z.enum(["start", "stop", "restart"]),
    }),
    async execute(args) {
      return await run("container_action", args);
    },
  },
  {
    name: "list_plugins",
    description:
      "List all plugins installed on the Pi (e.g. smart_pump). Returns id, name, enabled state, kind, and config.",
    scope: "read",
    inputSchema: z.object({}),
    async execute() {
      return await run("plugin_list");
    },
  },
  {
    name: "get_plugin",
    description:
      "Get one plugin with its current AI watering plan, recent decisions, and pump state.",
    scope: "read",
    inputSchema: z.object({ id: z.string().min(1).max(64) }),
    async execute(args) {
      return await run("plugin_get", args);
    },
  },
  {
    name: "run_planner_now",
    description:
      "Force the AI planner to rebuild the watering plan for a plugin right now. Returns the new plan + rationale.",
    scope: "control",
    inputSchema: z.object({ id: z.string().min(1).max(64) }),
    async execute(args) {
      return await run("plugin_run_planner", args);
    },
  },
  {
    name: "pump_set",
    description:
      "Manually turn the pump ON or OFF for a plugin, with a duration in minutes (1-120, default 10). The Pi's safety caps still apply.",
    scope: "control",
    inputSchema: z.object({
      id: z.string().min(1).max(64),
      action: z.enum(["on", "off"]),
      minutes: z.number().int().min(1).max(120).optional(),
    }),
    async execute(args) {
      return await run("plugin_manual", { ...args, runner: "nodered" });
    },
  },
  {
    name: "mqtt_publish",
    description:
      "Publish a raw MQTT message via the Pi's broker. Topic must match [a-zA-Z0-9_/+#.\\-]; payload max 64KB. Requires the 'control' scope.",
    scope: "control",
    inputSchema: z.object({
      topic: z.string().min(1).max(512).regex(/^[a-zA-Z0-9_/+#.\-]+$/),
      payload: z.string().max(64 * 1024).default(""),
      broker: z.string().regex(/^[a-zA-Z0-9_.\-:]{1,253}$/).optional(),
      port: z.number().int().min(1).max(65535).optional(),
    }),
    async execute(args) {
      return await run("mqtt_publish", args);
    },
  },
  {
    name: "list_recent_events",
    description:
      "List the most recent events stored on the Pi (Node-RED sensor events with status healthy / warning / critical). Covers the last 48 hours.",
    scope: "read",
    inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    async execute(args) {
      const rows = await history("event", 48 * 60);
      return { events: rows.slice(-(args.limit ?? 50)).reverse() };
    },
  },
  {
    name: "get_power_history",
    description:
      "Return the recent watt timeseries recorded on the Pi (Tibber Pulse / Tasmota). Use this to reason about household electricity usage, appliance behavior or PV surplus.",
    scope: "read",
    inputSchema: z.object({
      window_minutes: z.number().int().min(1).max(720).default(60),
      component: z.string().min(1).max(64).optional(),
    }),
    async execute(args) {
      const rows = await history("tick", args.window_minutes ?? 60, args.component);
      const series = rows
        .map((r) => ({ ts: r.ts, watts: wattsOf(r), component: r.component }))
        .filter((p) => p.watts != null);
      return { series, count: series.length };
    },
  },
  {
    name: "get_tibber_price_now",
    description:
      "Return the most recent electricity spot price the Pi has reported (ct/kWh) plus when it was observed.",
    scope: "read",
    inputSchema: z.object({}),
    async execute() {
      const s = await getPiState();
      const direct =
        (s.data as any)?.tibber_ct_per_kwh ?? (s.data as any)?.price_ct_per_kwh ?? null;
      if (direct != null) {
        return {
          available: true,
          tibber_ct_per_kwh: Number(direct),
          observed_at: s.data?.ts ?? null,
          stale: s.stale,
        };
      }
      const rows = await history("tick", 180);
      const row = [...rows]
        .reverse()
        .find((r) => r.metrics?.tibber_ct != null || r.metrics?.tibber != null);
      if (!row) return { available: false };
      return {
        available: true,
        tibber_ct_per_kwh: Number(row.metrics?.tibber_ct ?? row.metrics?.tibber),
        observed_at: row.ts ?? null,
        component: row.component,
      };
    },
  },
  {
    name: "infer_appliance_state",
    description:
      "Reason about whether a household appliance (washing machine, dishwasher, …) is currently running or finished, based on the watt timeseries stored on the Pi. Use this for questions like 'ist meine Wäsche fertig?'.",
    scope: "read",
    inputSchema: z.object({
      appliance: z.string().min(1).max(64).describe("Appliance name, e.g. 'Waschmaschine'"),
      window_minutes: z.number().int().min(10).max(360).default(120),
    }),
    async execute(args) {
      // Thresholds are generic now that profiles no longer live in a database.
      const profile = {
        name: args.appliance,
        min_watts: 150,
        min_runtime_min: 10,
        idle_watts: 5,
        idle_after_min: 3,
      };
      const rows = await history("tick", args.window_minutes ?? 120);
      const series = rows
        .map((r) => ({ t: new Date(String(r.ts ?? Date.now())).getTime(), w: wattsOf(r) }))
        .filter((p) => p.w != null) as Array<{ t: number; w: number }>;

      if (series.length === 0) {
        return {
          appliance: profile.name,
          available: false,
          note: "Keine Watt-Daten im Fenster — Node-RED pusht eventuell nicht.",
        };
      }

      const now = Date.now();
      let runEnd = -1;
      let runStart = -1;
      for (let i = series.length - 1; i >= 0; i--) {
        if (series[i].w >= profile.min_watts) {
          if (runEnd === -1) runEnd = i;
          runStart = i;
        } else if (runEnd !== -1) break;
      }
      if (runEnd === -1) {
        const last = series[series.length - 1];
        return {
          appliance: profile.name,
          running: false,
          finished: false,
          note: `Keine Phase >= ${profile.min_watts} W in den letzten ${args.window_minutes} min. Letzter Wert ${last.w.toFixed(0)} W.`,
        };
      }

      const runMinutes = (series[runEnd].t - series[runStart].t) / 60_000;
      const validRun = runMinutes >= profile.min_runtime_min;
      const lastIdx = series.length - 1;
      const idleAfterEnd = (now - series[runEnd].t) / 60_000;
      const tail = series.slice(runEnd + 1);
      const tailAllIdle = tail.length > 0 && tail.every((p) => p.w < profile.idle_watts);
      const finished = validRun && tailAllIdle && idleAfterEnd >= profile.idle_after_min;
      const running = !finished && series[lastIdx].w >= profile.min_watts;

      return {
        appliance: profile.name,
        running,
        finished,
        runtime_min: Math.round(runMinutes),
        last_watts: series[lastIdx].w,
        idle_since_min: finished ? Math.round(idleAfterEnd) : null,
        confidence: validRun ? (finished ? 0.85 : running ? 0.8 : 0.5) : 0.4,
        profile_used: profile,
      };
    },
  },
];

/** Dynamic per-plugin tools, discovered live from the Pi (cached by the relay). */
export async function getToolsForDevice(_ctx: ToolCtx): Promise<ToolDef[]> {
  let plugins: any[] = [];
  try {
    const r = await relayCommand("plugin_list", {});
    const res: any = r.result;
    plugins = res?.plugins ?? res?.result?.plugins ?? [];
  } catch {
    plugins = [];
  }

  const dynamicTools: ToolDef[] = [];
  for (const p of plugins) {
    if (!p?.commands) continue;
    for (const c of p.commands) {
      dynamicTools.push({
        name: `${String(p.name).toLowerCase().replace(/\s+/g, "_")}_${String(c.name).toLowerCase()}`,
        description: `${c.description || c.label} (Plugin: ${p.name})`,
        scope: c.type === "control" ? "control" : "read",
        inputSchema: z.object({
          minutes: z
            .number()
            .int()
            .min(1)
            .max(120)
            .optional()
            .describe("Duration in minutes (if applicable)"),
        }),
        async execute(args) {
          if (c.type === "control") {
            return await run("plugin_manual", {
              id: p.id,
              runner: "nodered",
              action: String(c.name).includes("off") ? "off" : "on",
              minutes: args.minutes,
              command: c.name,
            });
          }
          return await run("plugin_get", { id: p.id });
        },
      });
    }
  }
  return [...TOOLS, ...dynamicTools];
}

export async function findTool(name: string, ctx?: ToolCtx): Promise<ToolDef | null> {
  const tools = ctx ? await getToolsForDevice(ctx) : TOOLS;
  return tools.find((t) => t.name === name) ?? null;
}

// ---- token verification + audit -------------------------------------------

/**
 * Verify a bearer token. Accepts:
 *  - stateless HMAC access tokens (Alexa OAuth, MCP tokens issued by this app)
 *  - the raw device token, so a personal setup can call MCP without OAuth
 */
export async function resolveToken(
  rawToken: string,
): Promise<{ ok: true; ctx: ToolCtx } | { ok: false; error: string }> {
  const { token: deviceToken } = piConfig();
  if (deviceToken && rawToken === deviceToken) {
    return {
      ok: true,
      ctx: { userId: "owner", deviceId: "pi", scopes: ["read", "control"], tokenId: "device" },
    };
  }

  const payload = verifyToken(rawToken, "access");
  if (!payload) return { ok: false, error: "invalid or expired token" };
  const scopes = ((payload.sc as string[] | undefined) ?? ["read"]).filter(
    (s): s is Scope => s === "read" || s === "control",
  );
  return {
    ok: true,
    ctx: {
      userId: payload.sub,
      deviceId: "pi",
      scopes: scopes.length ? scopes : ["read"],
      tokenId: String(payload.iat),
    },
  };
}

// In-memory audit ring (volatile, free). Nothing is persisted any more.
export interface AuditEntry {
  at: string;
  tool: string;
  status: "ok" | "error" | "denied";
  latencyMs: number;
  error?: string;
}
const AUDIT_MAX = 200;
const auditRing: AuditEntry[] = [];

export async function writeAudit(
  _ctx: ToolCtx | null,
  tool: string,
  status: "ok" | "error" | "denied",
  latencyMs: number,
  error?: string,
) {
  auditRing.push({
    at: new Date().toISOString(),
    tool,
    status,
    latencyMs,
    ...(error ? { error: error.slice(0, 500) } : {}),
  });
  if (auditRing.length > AUDIT_MAX) auditRing.splice(0, auditRing.length - AUDIT_MAX);
}

export function recentAudit(limit = 50): AuditEntry[] {
  return auditRing.slice(-limit).reverse();
}

// Convert Zod → MCP-style JSON Schema (minimal — sufficient for tool params).
export function zodToJsonSchema(schema: z.ZodTypeAny): any {
  const t: any = schema;
  if (t._def?.typeName === "ZodObject") {
    const shape = t._def.shape();
    const props: any = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries<any>(shape)) {
      props[k] = zodToJsonSchema(v);
      if (!v.isOptional?.() && v._def?.typeName !== "ZodDefault") required.push(k);
    }
    return { type: "object", properties: props, ...(required.length ? { required } : {}) };
  }
  if (t._def?.typeName === "ZodString") {
    const out: any = { type: "string" };
    const checks = t._def.checks ?? [];
    for (const c of checks) {
      if (c.kind === "min") out.minLength = c.value;
      if (c.kind === "max") out.maxLength = c.value;
      if (c.kind === "regex") out.pattern = c.regex.source;
    }
    return out;
  }
  if (t._def?.typeName === "ZodNumber") {
    const out: any = { type: "number" };
    const checks = t._def.checks ?? [];
    for (const c of checks) {
      if (c.kind === "min") out.minimum = c.value;
      if (c.kind === "max") out.maximum = c.value;
      if (c.kind === "int") out.type = "integer";
    }
    return out;
  }
  if (t._def?.typeName === "ZodEnum") return { type: "string", enum: t._def.values };
  if (t._def?.typeName === "ZodArray") return { type: "array", items: zodToJsonSchema(t._def.type) };
  if (t._def?.typeName === "ZodOptional" || t._def?.typeName === "ZodDefault")
    return zodToJsonSchema(t._def.innerType);
  if (t._def?.typeName === "ZodBoolean") return { type: "boolean" };
  return {};
}
