// Shared voice/intent router used by Alexa (/api/public/voice/alexa),
// Telegram (/api/public/telegram/webhook/$userId) and the AI brain.
//
// DATABASE-FREE (Phase 2/3): every intent goes straight to the Pi through the
// relay. Reads fall back to the volatile worker cache and then say how old the
// answer is; commands never use a cache and report failure honestly.

import { describeAge, getPiState, relayCommand, type PiState } from "@/lib/pi-relay.server";

export type IntentSource = "alexa" | "telegram" | "mcp" | "chat";

export interface IntentCtx {
  source: IntentSource;
  /** kept for call-site compatibility; no longer used for storage */
  userId?: string;
  deviceId?: string;
}

export interface IntentResult {
  ok: boolean;
  speech: string;
  detail?: unknown;
}

function offline(): IntentResult {
  return { ok: false, speech: "Der Pi ist gerade nicht erreichbar." };
}

function staleSuffix(stale: boolean, ageSec: number | null) {
  return stale ? ` (Stand ${describeAge(ageSec)})` : "";
}

async function readState(): Promise<{
  s: PiState | null;
  stale: boolean;
  ageSec: number | null;
}> {
  const r = await getPiState();
  return { s: r.data, stale: r.stale, ageSec: r.ageSec };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- pump.on
export async function pumpOn(_ctx: IntentCtx, minutes?: number): Promise<IntentResult> {
  const m = Math.max(1, Math.min(120, Number.isFinite(minutes as number) ? (minutes as number) : 10));
  const out = await relayCommand("plugin_manual", {
    id: "pump",
    runner: "nodered",
    action: "on",
    minutes: m,
  });
  if (!out.ok) {
    return {
      ok: false,
      speech:
        out.error === "pi_not_configured"
          ? "Der Pi ist noch nicht mit der Cloud verbunden."
          : "Konnte die Pumpe nicht einschalten, der Pi antwortet nicht.",
    };
  }
  return { ok: true, speech: `Pumpe an für ${m} Minuten.`, detail: out.result };
}

// --------------------------------------------------------------- pump.off
export async function pumpOff(_ctx: IntentCtx): Promise<IntentResult> {
  const out = await relayCommand("plugin_manual", { id: "pump", runner: "nodered", action: "off" });
  if (!out.ok) return { ok: false, speech: "Konnte die Pumpe nicht ausschalten." };
  return { ok: true, speech: "Pumpe aus.", detail: out.result };
}

// ------------------------------------------------------------ pump.status
export async function pumpStatus(_ctx: IntentCtx): Promise<IntentResult> {
  const { s, stale, ageSec } = await readState();
  if (!s) return offline();
  const on = s.pump_on === true;
  const w = num(s.watts);
  const strategy = s.strategy_applied ? ` – Strategie: ${s.strategy_applied}` : "";
  const base = on
    ? `Pumpe läuft${w != null ? `, ${Math.round(w)} Watt` : ""}${strategy}`
    : `Pumpe ist aus${w != null ? `, aktuell ${Math.round(w)} Watt` : ""}${strategy}`;
  return { ok: true, speech: `${base}${staleSuffix(stale, ageSec)}.`, detail: s };
}

// ---------------------------------------------------------- system.status
export async function systemStatus(_ctx: IntentCtx): Promise<IntentResult> {
  const { s, stale, ageSec } = await readState();
  if (!s) return offline();
  const sys = (s as any).system ?? s;
  const parts: string[] = [];
  const cpu = num(sys.cpu_pct ?? sys.cpu);
  const temp = num(sys.temp_c ?? sys.tempC);
  const mem = num(sys.mem_pct ?? sys.ram);
  if (cpu != null) parts.push(`CPU ${Math.round(cpu)} Prozent`);
  if (temp != null) parts.push(`Temperatur ${Math.round(temp)} Grad`);
  if (mem != null) parts.push(`RAM ${Math.round(mem)} Prozent`);
  return {
    ok: true,
    speech: (parts.length ? parts.join(", ") : "System läuft") + staleSuffix(stale, ageSec) + ".",
    detail: s,
  };
}

// -------------------------------------------------------- energy.price_now
export async function energyPriceNow(_ctx: IntentCtx): Promise<IntentResult> {
  const { s, stale, ageSec } = await readState();
  const ct = num((s as any)?.tibber_ct_per_kwh ?? (s as any)?.price_ct_per_kwh);
  if (ct == null) return { ok: true, speech: "Kein aktueller Strompreis verfügbar." };
  return {
    ok: true,
    speech: `Strom kostet gerade ${ct.toFixed(1)} Cent pro Kilowattstunde${staleSuffix(stale, ageSec)}.`,
    detail: s,
  };
}

// ----------------------------------------------------------- mqtt.publish
export async function mqttPublish(
  _ctx: IntentCtx,
  topic: string,
  payload: string,
): Promise<IntentResult> {
  if (!/^cmnd\/[a-z0-9_\-\/]+$/i.test(topic)) {
    return { ok: false, speech: `Topic ${topic} nicht erlaubt.` };
  }
  const out = await relayCommand("mqtt_publish", { topic, payload });
  if (!out.ok) return { ok: false, speech: "MQTT-Kommando fehlgeschlagen." };
  return { ok: true, speech: `MQTT ${topic} gesendet.`, detail: out.result };
}

/**
 * Legacy helper. There is no device table any more — a Pi-Hub install talks to
 * exactly one Pi, configured through PIHUB_PI_URL.
 */
export async function resolveDefaultDevice(): Promise<string | null> {
  const { piConfig } = await import("@/lib/pi-relay.server");
  return piConfig().configured ? "pi" : null;
}
