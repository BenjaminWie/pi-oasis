// Shared voice/intent router used by both Alexa (/api/public/voice/alexa)
// and Telegram (/api/public/telegram/webhook/$userId).
//
// Zero-Wake rules enforced here:
//   - Read-only intents (pump.status, system.status, energy.price_now,
//     laundry.state) read from device_state_latest / cached rows and MUST NOT
//     write an audit row.
//   - Mutating intents (pump.on, pump.off, mqtt.publish) enqueue an
//     agent_commands row and broadcast a wake ping to commands:<device_id>.
//     Only these write to mcp_audit.

import { broadcastCommandWake } from "@/lib/broadcast.server";

export type IntentSource = "alexa" | "telegram" | "mcp";

export interface IntentCtx {
  userId: string;
  deviceId: string;
  source: IntentSource;
}

export interface IntentResult {
  ok: boolean;
  speech: string; // short human-readable answer (used by both Alexa and Telegram)
  detail?: unknown;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function audit(ctx: IntentCtx, intent: string, status: "ok" | "error", latencyMs: number, error?: string) {
  const sb = await admin();
  await sb.from("mcp_audit").insert({
    user_id: ctx.userId,
    device_id: ctx.deviceId,
    tool_name: `intent:${intent}`,
    status,
    latency_ms: latencyMs,
    error: error ?? null,
    source: ctx.source,
  } as any).catch(() => {});
}

async function enqueue(ctx: IntentCtx, kind: string, payload: Record<string, unknown>) {
  const sb = await admin();
  const { data, error } = await sb
    .from("agent_commands")
    .insert({
      device_id: ctx.deviceId,
      user_id: ctx.userId,
      kind,
      payload: payload as any,
      source: ctx.source,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  // wake Node-RED via Realtime broadcast — Postgres is NOT long-polled.
  void broadcastCommandWake(ctx.deviceId);
  return data!.id as string;
}

async function readStateLatest(ctx: IntentCtx) {
  const sb = await admin();
  const { data } = await sb
    .from("device_state_latest")
    .select("*")
    .eq("device_id", ctx.deviceId)
    .maybeSingle();
  return data as any;
}

// ----------------------------------------------------------------------
// pump.on(minutes?)
// ----------------------------------------------------------------------
export async function pumpOn(ctx: IntentCtx, minutes?: number): Promise<IntentResult> {
  const t0 = Date.now();
  const m = Math.max(1, Math.min(120, Number.isFinite(minutes as number) ? (minutes as number) : 10));
  try {
    await enqueue(ctx, "plugin_manual", { id: "pump", runner: "nodered", action: "on", minutes: m });
    await audit(ctx, "pump.on", "ok", Date.now() - t0);
    return { ok: true, speech: `Pumpe an für ${m} Minuten.` };
  } catch (e: any) {
    await audit(ctx, "pump.on", "error", Date.now() - t0, String(e?.message ?? e));
    return { ok: false, speech: "Konnte die Pumpe nicht einschalten." };
  }
}

// ----------------------------------------------------------------------
// pump.off()
// ----------------------------------------------------------------------
export async function pumpOff(ctx: IntentCtx): Promise<IntentResult> {
  const t0 = Date.now();
  try {
    await enqueue(ctx, "plugin_manual", { id: "pump", runner: "nodered", action: "off" });
    await audit(ctx, "pump.off", "ok", Date.now() - t0);
    return { ok: true, speech: "Pumpe aus." };
  } catch (e: any) {
    await audit(ctx, "pump.off", "error", Date.now() - t0, String(e?.message ?? e));
    return { ok: false, speech: "Konnte die Pumpe nicht ausschalten." };
  }
}

// ----------------------------------------------------------------------
// pump.status — READ-ONLY, no audit, no wake.
// ----------------------------------------------------------------------
export async function pumpStatus(ctx: IntentCtx): Promise<IntentResult> {
  const s = await readStateLatest(ctx);
  if (!s) return { ok: true, speech: "Ich habe noch keine Pumpendaten." };
  const on = !!s.pump_on;
  const w = s.watts != null ? Math.round(Number(s.watts)) : null;
  const strategy = s.strategy_applied ? ` – Strategie: ${s.strategy_applied}` : "";
  return {
    ok: true,
    speech: on
      ? `Pumpe läuft${w != null ? `, ${w} Watt` : ""}${strategy}.`
      : `Pumpe ist aus${w != null ? `, aktuell ${w} Watt` : ""}${strategy}.`,
    detail: s,
  };
}

// ----------------------------------------------------------------------
// system.status — READ-ONLY
// ----------------------------------------------------------------------
export async function systemStatus(ctx: IntentCtx): Promise<IntentResult> {
  const s = await readStateLatest(ctx);
  if (!s) return { ok: true, speech: "Kein System-Status verfügbar." };
  const parts: string[] = [];
  if (s.cpu_pct != null) parts.push(`CPU ${Math.round(s.cpu_pct)} Prozent`);
  if (s.temp_c != null) parts.push(`Temperatur ${Math.round(s.temp_c)} Grad`);
  if (s.mem_pct != null) parts.push(`RAM ${Math.round(s.mem_pct)} Prozent`);
  return {
    ok: true,
    speech: parts.length ? parts.join(", ") + "." : "System läuft.",
    detail: s,
  };
}

// ----------------------------------------------------------------------
// energy.price_now — READ-ONLY (from device_state_latest.tibber_ct_per_kwh)
// ----------------------------------------------------------------------
export async function energyPriceNow(ctx: IntentCtx): Promise<IntentResult> {
  const s = await readStateLatest(ctx);
  const ct = s?.tibber_ct_per_kwh;
  if (ct == null) return { ok: true, speech: "Kein aktueller Strompreis verfügbar." };
  return { ok: true, speech: `Strom kostet gerade ${Number(ct).toFixed(1)} Cent pro Kilowattstunde.`, detail: s };
}

// ----------------------------------------------------------------------
// mqtt.publish — mutating, whitelisted to cmnd/*
// ----------------------------------------------------------------------
export async function mqttPublish(ctx: IntentCtx, topic: string, payload: string): Promise<IntentResult> {
  const t0 = Date.now();
  if (!/^cmnd\/[a-z0-9_\-\/]+$/i.test(topic)) {
    await audit(ctx, "mqtt.publish", "error", Date.now() - t0, "topic not in cmnd/* whitelist");
    return { ok: false, speech: `Topic ${topic} nicht erlaubt.` };
  }
  try {
    await enqueue(ctx, "mqtt_publish", { topic, payload });
    await audit(ctx, "mqtt.publish", "ok", Date.now() - t0);
    return { ok: true, speech: `MQTT ${topic} gesendet.` };
  } catch (e: any) {
    await audit(ctx, "mqtt.publish", "error", Date.now() - t0, String(e?.message ?? e));
    return { ok: false, speech: "MQTT-Kommando fehlgeschlagen." };
  }
}

// ----------------------------------------------------------------------
// Utility: resolve the user's first paired device (Telegram + Alexa share this)
// ----------------------------------------------------------------------
export async function resolveDefaultDevice(userId: string): Promise<string | null> {
  const sb = await admin();
  const { data } = await sb
    .from("devices")
    .select("id, device_token_hash, last_seen_at")
    .eq("user_id", userId)
    .not("device_token_hash", "is", null)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as any)?.id ?? null;
}
