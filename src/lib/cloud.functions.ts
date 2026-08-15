import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function randomCode(len: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}




// === Devices =================================================================

export const listDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("devices")
      .select(
        "id, name, last_seen_at, last_snapshot, created_at, pairing_code, pairing_expires_at, device_token_hash",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      lastSeenAt: d.last_seen_at,
      snapshot: d.last_snapshot,
      createdAt: d.created_at,
      pairing: d.pairing_code ? { code: d.pairing_code, expiresAt: d.pairing_expires_at } : null,
      paired: !!d.device_token_hash,
    }));
  });

export const getDevice = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const { data: device, error } = await context.supabase
      .from("devices")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);

    const { data: commands } = await context.supabase
      .from("agent_commands")
      .select("id, kind, payload, status, result, source, created_at, completed_at")
      .eq("device_id", data.id)
      .order("created_at", { ascending: false })
      .limit(20);

    // Live mirror written by Node-RED / the Pi (system telemetry + pump state).
    const { data: state } = await context.supabase
      .from("device_state_latest")
      .select("*")
      .eq("device_id", data.id)
      .maybeSingle();

    return { device, commands: commands ?? [], state: state ?? null };
  });


export const createDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ name: z.string().min(1).max(64) }).parse)
  .handler(async ({ data, context }) => {
    const code = randomCode(8);
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { data: device, error } = await context.supabase
      .from("devices")
      .insert({
        user_id: context.userId,
        name: data.name,
        pairing_code: code,
        pairing_expires_at: expires,
      })
      .select("id, name, pairing_code, pairing_expires_at")
      .single();
    if (error) throw new Error(error.message);
    return device;
  });

export const regeneratePairing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const code = randomCode(8);
    const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await context.supabase
      .from("devices")
      .update({
        pairing_code: code,
        pairing_expires_at: expires,
        device_token_hash: null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { code, expiresAt: expires };
  });

export const deleteDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("devices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// === Commands ================================================================

const commandSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("status"),
    deviceId: z.string().uuid(),
    payload: z.object({}).optional().default({}),
  }),
  z.object({
    kind: z.literal("system_reboot"),
    deviceId: z.string().uuid(),
    payload: z.object({}).optional().default({}),
  }),
  z.object({
    kind: z.literal("container_action"),
    deviceId: z.string().uuid(),
    payload: z.object({
      name: z
        .string()
        .min(1)
        .max(128)
        .regex(/^[a-zA-Z0-9_.\-]+$/),
      action: z.enum(["start", "stop", "restart"]),
    }),
  }),
  z.object({
    kind: z.literal("mqtt_publish"),
    deviceId: z.string().uuid(),
    payload: z.object({
      topic: z.string().min(1).max(512),
      payload: z
        .string()
        .max(64 * 1024)
        .optional()
        .default(""),
      broker: z
        .string()
        .regex(/^[a-zA-Z0-9_.\-:]{1,253}$/)
        .optional(),
      port: z.number().int().min(1).max(65535).optional(),
    }),
  }),
  z.object({
    kind: z.literal("mqtt_subscribe"),
    deviceId: z.string().uuid(),
    payload: z.object({
      topic: z.string().min(1).max(512),
    }),
  }),
  z.object({
    kind: z.literal("terminal"),
    deviceId: z.string().uuid(),
    payload: z.object({
      cmd: z.string().min(1).max(512),
    }),
  }),
  z.object({
    kind: z.literal("plugin_list"),
    deviceId: z.string().uuid(),
    payload: z.object({}).optional().default({}),
  }),
  z.object({
    kind: z.literal("plugin_get"),
    deviceId: z.string().uuid(),
    payload: z.object({
      id: z.string().min(1).max(64),
    }),
  }),
  z.object({
    kind: z.literal("plugin_run_planner"),
    deviceId: z.string().uuid(),
    payload: z.object({
      id: z.string().min(1).max(64),
    }),
  }),
  z.object({
    kind: z.literal("plugin_manual"),
    deviceId: z.string().uuid(),
    payload: z.object({
      id: z.string().min(1).max(64),
      action: z.enum(["on", "off"]),
      minutes: z.number().int().min(1).max(120).optional(),
      runner: z.enum(["nodered"]).optional(),
    }),
  }),
]);

export const enqueueCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(commandSchema.parse)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("agent_commands")
      .insert({
        device_id: data.deviceId,
        user_id: context.userId,
        kind: data.kind,
        payload: data.payload,
        source: "ui",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    // Zero-Wake: ping the Realtime channel so Node-RED / the Pi bridge polls now
    try {
      const { broadcastCommandWake } = await import("@/lib/broadcast.server");
      void broadcastCommandWake(data.deviceId, {
        id: row.id,
        kind: data.kind,
        payload: data.payload,
      });
    } catch { /* best-effort */ }
    return { id: row.id };
  });

// === Profile / Telegram ======================================================

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select(
        "display_name, telegram_bot_username, telegram_chat_id, telegram_linked_at, telegram_link_code",
      )
      .eq("id", context.userId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

// Telegram linking moved to the database-free flow in src/lib/wiring.functions.ts
// (env secrets + /api/public/telegram/webhook). The old profile-backed
// linkTelegramBot/unlinkTelegramBot pair was removed with the $userId webhook.


export const listAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("telegram_audit")
      .select("id, command, device_id, result, created_at, chat_id")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
