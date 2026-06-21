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

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// === Devices =================================================================

export const listDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("devices")
      .select("id, name, last_seen_at, last_snapshot, created_at, pairing_code, pairing_expires_at, device_token_hash")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      lastSeenAt: d.last_seen_at,
      snapshot: d.last_snapshot,
      createdAt: d.created_at,
      pairing: d.pairing_code
        ? { code: d.pairing_code, expiresAt: d.pairing_expires_at }
        : null,
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

    return { device, commands: commands ?? [] };
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
    const { error } = await context.supabase
      .from("devices")
      .delete()
      .eq("id", data.id);
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
    kind: z.literal("container_action"),
    deviceId: z.string().uuid(),
    payload: z.object({
      name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.\-]+$/),
      action: z.enum(["start", "stop", "restart"]),
    }),
  }),
  z.object({
    kind: z.literal("mqtt_publish"),
    deviceId: z.string().uuid(),
    payload: z.object({
      topic: z.string().min(1).max(512),
      payload: z.string().max(64 * 1024).optional().default(""),
      broker: z.string().regex(/^[a-zA-Z0-9_.\-:]{1,253}$/).optional(),
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
    return { id: row.id };
  });

// === Profile / Telegram ======================================================

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("display_name, telegram_bot_username, telegram_chat_id, telegram_linked_at, telegram_link_code")
      .eq("id", context.userId)
      .single();
    if (error) throw new Error(error.message);
    return data;
  });

export const linkTelegramBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/) }).parse)
  .handler(async ({ data, context }) => {
    // Verify token + fetch bot info
    const meRes = await fetch(`https://api.telegram.org/bot${data.token}/getMe`);
    const me = await meRes.json();
    if (!meRes.ok || !me.ok) throw new Error("Telegram-Token ungültig: " + (me.description || meRes.status));

    const webhookSecret = await sha256Hex(`tg:${context.userId}:${data.token}`);
    const linkCode = randomCode(6);

    // Build webhook URL: prefer header host
    const reqUrl = new URL(
      (await import("@tanstack/react-start/server")).getRequest().url,
    );
    const webhookUrl = `${reqUrl.origin}/api/public/telegram/webhook/${context.userId}`;

    const setRes = await fetch(`https://api.telegram.org/bot${data.token}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message"],
      }),
    });
    const setBody = await setRes.json();
    if (!setRes.ok || !setBody.ok) {
      throw new Error("setWebhook fehlgeschlagen: " + (setBody.description || setRes.status));
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        telegram_bot_token: data.token,
        telegram_bot_username: me.result.username,
        telegram_webhook_secret: webhookSecret,
        telegram_link_code: linkCode,
        telegram_chat_id: null,
        telegram_linked_at: null,
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    return { username: me.result.username, linkCode, webhookUrl };
  });

export const unlinkTelegramBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("telegram_bot_token")
      .eq("id", context.userId)
      .single();
    if (prof?.telegram_bot_token) {
      await fetch(`https://api.telegram.org/bot${prof.telegram_bot_token}/deleteWebhook`, {
        method: "POST",
      }).catch(() => {});
    }
    await supabaseAdmin
      .from("profiles")
      .update({
        telegram_bot_token: null,
        telegram_bot_username: null,
        telegram_webhook_secret: null,
        telegram_chat_id: null,
        telegram_link_code: null,
        telegram_linked_at: null,
      })
      .eq("id", context.userId);
    return { ok: true };
  });

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
