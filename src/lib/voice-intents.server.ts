// Shared intent router for Alexa and Telegram. DATABASE-FREE.
//
// Everything is expressed against the Pi's self-announced endpoint catalogue:
// nothing here knows about pumps or plugins, it just looks up an endpoint by
// name and reads or sets it.

import { describeAge, getPiEndpoints, relayInvoke } from "@/lib/pi-relay.server";
import { findEndpoint, invoke, readEndpoints, statusOf, summarize } from "@/lib/relay-tools.server";

export type IntentSource = "alexa" | "telegram" | "mcp" | "chat";

export interface IntentCtx {
  source: IntentSource;
  userId?: string;
  deviceId?: string;
  allowControl?: boolean;
}

export interface IntentResult {
  ok: boolean;
  speech: string;
  detail?: unknown;
}

const PUMP_HINTS = ["pump", "pumpe", "zisterne", "bewaesserung", "bewässerung", "irrigation"];

async function resolvePump(): Promise<string | null> {
  const { endpoints } = await readEndpoints();
  for (const h of PUMP_HINTS) {
    const ep = findEndpoint(endpoints, h);
    if (ep && ep.kind !== "read") return ep.id;
  }
  return null;
}

/** Full catalogue as speech (used by "/endpoints" and Alexa's list intent). */
export async function endpointList(): Promise<IntentResult> {
  const { endpoints, stale, ageSec, ok } = await readEndpoints();
  if (!endpoints.length) {
    return {
      ok: false,
      speech: ok ? "Der Pi meldet noch keine Endpunkte." : "Der Pi ist nicht erreichbar.",
    };
  }
  return { ok: true, speech: summarize(endpoints, stale, ageSec), detail: endpoints };
}

/** Read one endpoint (or everything when no name is given). */
export async function endpointStatus(_ctx: IntentCtx, query?: string): Promise<IntentResult> {
  return statusOf(query);
}

/** Set one endpoint by name. */
export async function endpointSet(
  ctx: IntentCtx,
  query: string,
  value: string | number | boolean,
): Promise<IntentResult> {
  return invoke(
    { source: ctx.source === "alexa" ? "alexa" : ctx.source === "telegram" ? "telegram" : "chat", allowControl: ctx.allowControl },
    query,
    value,
  );
}

// ------------------------------------------------- convenience: pump & system
export async function pumpOn(ctx: IntentCtx, minutes?: number): Promise<IntentResult> {
  const id = await resolvePump();
  if (!id) return { ok: false, speech: "Ich finde keinen Pumpen-Endpunkt in Node-RED." };
  const m = Math.max(1, Math.min(120, Number.isFinite(minutes as number) ? (minutes as number) : 10));
  const out = await relayInvoke(id, m);
  if (!out.ok) {
    const fallback = await relayInvoke(id, true);
    if (!fallback.ok) {
      return {
        ok: false,
        speech:
          out.error === "pi_not_configured"
            ? "Der Pi ist noch nicht mit der Cloud verbunden."
            : "Konnte die Pumpe nicht einschalten, der Pi antwortet nicht.",
      };
    }
  }
  return { ok: true, speech: `Pumpe an für ${m} Minuten.`, detail: out.result };
}

export async function pumpOff(ctx: IntentCtx): Promise<IntentResult> {
  const id = await resolvePump();
  if (!id) return { ok: false, speech: "Ich finde keinen Pumpen-Endpunkt in Node-RED." };
  const out = await relayInvoke(id, false);
  if (!out.ok) return { ok: false, speech: "Konnte die Pumpe nicht ausschalten." };
  return { ok: true, speech: "Pumpe aus.", detail: out.result };
}

export async function pumpStatus(_ctx: IntentCtx): Promise<IntentResult> {
  const { endpoints, stale, ageSec } = await readEndpoints();
  const ep = PUMP_HINTS.map((h) => findEndpoint(endpoints, h)).find(Boolean);
  if (!ep) return endpointList();
  return { ok: true, speech: summarize([ep], stale, ageSec), detail: ep };
}

export async function systemStatus(_ctx: IntentCtx): Promise<IntentResult> {
  const r = await getPiEndpoints();
  if (!r.data) return { ok: false, speech: "Der Pi ist nicht erreichbar." };
  const sys = r.data.endpoints.filter((e) => /cpu|mem|ram|temp|disk|uptime/i.test(e.id));
  const list = sys.length ? sys : r.data.endpoints;
  return {
    ok: true,
    speech: summarize(list, r.stale, r.ageSec),
    detail: r.data,
  };
}

export async function energyPriceNow(_ctx: IntentCtx): Promise<IntentResult> {
  const { endpoints, stale, ageSec } = await readEndpoints();
  const ep = endpoints.find((e) => /price|preis|tibber|ct/i.test(e.id));
  if (!ep || ep.value == null) return { ok: true, speech: "Kein aktueller Strompreis verfügbar." };
  const v = typeof ep.value === "number" ? ep.value.toFixed(1) : String(ep.value);
  return {
    ok: true,
    speech: `Strom kostet gerade ${v} ${ep.unit ?? "Cent pro Kilowattstunde"}${stale ? ` (Stand ${describeAge(ageSec)})` : ""}.`,
    detail: ep,
  };
}

export async function mqttPublish(
  _ctx: IntentCtx,
  topic: string,
  payload: string,
): Promise<IntentResult> {
  if (!/^cmnd\/[a-z0-9_\-\/]+$/i.test(topic)) {
    return { ok: false, speech: `Topic ${topic} nicht erlaubt.` };
  }
  const { endpoints } = await readEndpoints();
  const ep = endpoints.find((e) => e.id === "mqtt_publish" || /mqtt/i.test(e.id));
  if (!ep) return { ok: false, speech: "Node-RED bietet keinen MQTT-Endpunkt an." };
  const out = await relayInvoke(ep.id, `${topic} ${payload}`);
  if (!out.ok) return { ok: false, speech: "MQTT-Kommando fehlgeschlagen." };
  return { ok: true, speech: `MQTT ${topic} gesendet.`, detail: out.result };
}

/** A Pi-Control install talks to exactly one Pi, configured through PIHUB_PI_URL. */
export async function resolveDefaultDevice(): Promise<string | null> {
  const { piConfig } = await import("@/lib/pi-relay.server");
  return piConfig().configured ? "pi" : null;
}
