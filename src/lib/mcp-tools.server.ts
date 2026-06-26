// MCP tool registry + executor. Each tool either reads from Supabase
// (cheap, sync) or enqueues an agent_command and waits for the Pi to
// post a result via /api/public/agent/result (up to ~25s).
//
// Server-only: imports supabaseAdmin. Never load from a route or
// component module-scope — always inside a handler.

import { z } from "zod";

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

async function enqueueAndWait(
  ctx: ToolCtx,
  kind: string,
  payload: Record<string, unknown>,
  timeoutMs = 25_000,
): Promise<{ ok: boolean; result: unknown; error?: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: cmd, error } = await supabaseAdmin
    .from("agent_commands")
    .insert({
      device_id: ctx.deviceId,
      user_id: ctx.userId,
      kind,
      payload: payload as any,
      source: "mcp",
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !cmd) return { ok: false, result: null, error: error?.message || "enqueue failed" };

  const deadline = Date.now() + timeoutMs;
  let lastStatus = "pending";
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 800));
    const { data: row } = await supabaseAdmin
      .from("agent_commands")
      .select("status, result")
      .eq("id", cmd.id)
      .maybeSingle();
    if (!row) continue;
    lastStatus = row.status;
    if (row.status === "done") return { ok: true, result: row.result };
    if (row.status === "failed") {
      return { ok: false, result: row.result, error: "command failed" };
    }
  }
  return { ok: false, result: null, error: `pi_offline (status=${lastStatus})` };
}

async function getSnapshot(ctx: ToolCtx) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("devices")
    .select("last_snapshot, last_seen_at, name")
    .eq("id", ctx.deviceId)
    .maybeSingle();
  return data;
}

// ---- tool defs -------------------------------------------------------------

export const TOOLS: ToolDef[] = [
  {
    name: "get_device_info",
    description:
      "Get the Pi device name, last-seen timestamp, and last known system snapshot (CPU, RAM, temperature, disk). Cheap — reads cached snapshot, does not contact the Pi.",
    scope: "read",
    inputSchema: z.object({}),
    async execute(_args, ctx) {
      const d = await getSnapshot(ctx);
      return {
        name: d?.name ?? null,
        lastSeenAt: d?.last_seen_at ?? null,
        snapshot: d?.last_snapshot ?? null,
      };
    },
  },
  {
    name: "get_status",
    description:
      "Fetch a fresh system status from the Pi (CPU, RAM, temperature, disk, uptime, container list, MQTT brokers). Round-trips to the device; may take a few seconds.",
    scope: "read",
    inputSchema: z.object({}),
    async execute(_args, ctx) {
      return await enqueueAndWait(ctx, "status", {});
    },
  },
  {
    name: "list_containers",
    description: "List Docker containers currently running on the Pi.",
    scope: "read",
    inputSchema: z.object({}),
    async execute(_args, ctx) {
      const r = await enqueueAndWait(ctx, "status", {});
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
    async execute(args, ctx) {
      return await enqueueAndWait(ctx, "container_action", args);
    },
  },
  {
    name: "list_plugins",
    description:
      "List all plugins installed on the Pi (e.g. smart_pump). Returns id, name, enabled state, kind, and config.",
    scope: "read",
    inputSchema: z.object({}),
    async execute(_args, ctx) {
      return await enqueueAndWait(ctx, "plugin_list", {});
    },
  },
  {
    name: "get_plugin",
    description:
      "Get one plugin with its current AI watering plan, recent decisions (last 50), and simulated pump state.",
    scope: "read",
    inputSchema: z.object({ id: z.string().min(1).max(64) }),
    async execute(args, ctx) {
      return await enqueueAndWait(ctx, "plugin_get", args);
    },
  },
  {
    name: "run_planner_now",
    description:
      "Force the AI planner to rebuild the watering plan for a plugin right now (pulls fresh weather forecast and calls the AI gateway). Returns the new plan + rationale.",
    scope: "control",
    inputSchema: z.object({ id: z.string().min(1).max(64) }),
    async execute(args, ctx) {
      return await enqueueAndWait(ctx, "plugin_run_planner", args, 35_000);
    },
  },
  {
    name: "pump_set",
    description:
      "Manually turn the pump ON or OFF for a plugin, with a duration in minutes (1-120, default 10). The Pi's safety caps (max minutes/day, min hours between runs) still apply.",
    scope: "control",
    inputSchema: z.object({
      id: z.string().min(1).max(64),
      action: z.enum(["on", "off"]),
      minutes: z.number().int().min(1).max(120).optional(),
    }),
    async execute(args, ctx) {
      return await enqueueAndWait(ctx, "plugin_manual", args);
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
    async execute(args, ctx) {
      return await enqueueAndWait(ctx, "mqtt_publish", args);
    },
  },
  {
    name: "list_recent_events",
    description:
      "List the most recent events the Pi has forwarded to the cloud (e.g. Node-RED sensor events with status healthy / warning / critical).",
    scope: "read",
    inputSchema: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
    async execute(args, ctx) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("device_events")
        .select("id, component, device_label, status, metrics, occurred_at, created_at")
        .eq("device_id", ctx.deviceId)
        .order("occurred_at", { ascending: false })
        .limit(args.limit ?? 50);
      if (error) throw new Error(error.message);
      return { events: data ?? [] };
    },
  },
];

export function findTool(name: string): ToolDef | null {
  return TOOLS.find((t) => t.name === name) ?? null;
}

// ---- token verification + audit -------------------------------------------

import { createHash } from "node:crypto";

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export async function resolveToken(rawToken: string): Promise<{
  ok: true;
  ctx: ToolCtx;
} | { ok: false; error: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const hash = sha256Hex(rawToken);
  const { data: tok } = await supabaseAdmin
    .from("mcp_tokens")
    .select("id, user_id, device_id, scopes, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!tok) return { ok: false, error: "invalid token" };
  if (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "token expired" };
  }
  // touch last_used (fire-and-forget)
  void supabaseAdmin
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", tok.id);
  return {
    ok: true,
    ctx: {
      userId: tok.user_id,
      deviceId: tok.device_id,
      scopes: (tok.scopes ?? ["read"]) as Scope[],
      tokenId: tok.id,
    },
  };
}

export async function writeAudit(
  ctx: ToolCtx | null,
  tool: string,
  status: "ok" | "error" | "denied",
  latencyMs: number,
  error?: string,
) {
  if (!ctx) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("mcp_audit").insert({
    user_id: ctx.userId,
    device_id: ctx.deviceId,
    token_id: ctx.tokenId,
    tool,
    status,
    latency_ms: latencyMs,
    error: error ? error.slice(0, 500) : null,
  });
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
  if (t._def?.typeName === "ZodEnum") {
    return { type: "string", enum: t._def.values };
  }
  if (t._def?.typeName === "ZodArray") {
    return { type: "array", items: zodToJsonSchema(t._def.type) };
  }
  if (t._def?.typeName === "ZodOptional" || t._def?.typeName === "ZodDefault") {
    return zodToJsonSchema(t._def.innerType);
  }
  if (t._def?.typeName === "ZodBoolean") return { type: "boolean" };
  return {};
}
