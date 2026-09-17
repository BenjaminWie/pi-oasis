// Shared intent router for Alexa, Telegram, the chat and the Debug simulator.
// DATABASE-FREE.
//
// Everything is expressed against the Pi's self-announced endpoint catalogue:
// nothing here knows about pumps or plugins, it just looks up an endpoint by
// name and reads or sets it. Every turn is written to the debug stream with its
// channel, so the Debug tab shows exactly what Alexa or Telegram asked for.

import { describeAge, getPiEndpoints, relayInvoke, type RelayEndpoint } from "@/lib/pi-relay.server";
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

// ------------------------------------------------------------------ logging
async function logTurn(
  ctx: IntentCtx,
  what: string,
  input: unknown,
  result: IntentResult,
  startedAt: number,
) {
  try {
    const { debugLog, debugLogVerbose, asChannel } = await import("@/lib/registry.server");
    const ch = asChannel(ctx.source);
    debugLog(
      result.ok ? "in" : "error",
      `${ctx.source}: ${what} → ${result.speech.slice(0, 90)}`,
      undefined,
      ch,
      Date.now() - startedAt,
    );
    debugLogVerbose("info", `${ctx.source}: ${what} (roh)`, { input, result }, ch);
  } catch {
    /* logging is best effort */
  }
}

async function turn(
  ctx: IntentCtx,
  what: string,
  input: unknown,
  run: () => Promise<IntentResult>,
): Promise<IntentResult> {
  const t0 = Date.now();
  let res: IntentResult;
  try {
    res = await run();
  } catch (e: unknown) {
    res = { ok: false, speech: `Fehler: ${String((e as Error)?.message ?? e).slice(0, 120)}` };
  }
  await logTurn(ctx, what, input, res, t0);
  return res;
}

// ----------------------------------------------------------------- lookups
const HINTS = {
  pump: ["pump", "pumpe", "zisterne", "cistern"],
  irrigation: ["bewaess", "bewäss", "irrigation", "water_now", "giess", "gieß"],
  night: ["nachtruhe", "night", "quiet", "ruhe"],
  surplus: ["surplus", "ueberschuss", "überschuss", "pv"],
  price: ["price", "preis", "tibber", "strompreis"],
  rain: ["rain", "regen"],
  strategy: ["strateg"],
  threshold: ["schwelle", "threshold", "limit"],
  runtime: ["laufzeit", "runtime", "minutes_today"],
} as const;

type HintKey = keyof typeof HINTS;

async function catalogue(ctx?: IntentCtx) {
  const r = await getPiEndpoints(ctx?.source);
  return {
    endpoints: r.data?.endpoints ?? [],
    stale: r.stale,
    ageSec: r.ageSec,
    ok: r.ok,
  };
}

function pick(
  endpoints: RelayEndpoint[],
  key: HintKey,
  opts: { writable?: boolean } = {},
): RelayEndpoint | null {
  for (const h of HINTS[key]) {
    const hits = endpoints.filter(
      (e) => e.id.toLowerCase().includes(h) || (e.label ?? "").toLowerCase().includes(h),
    );
    const hit = opts.writable ? hits.find((e) => e.kind !== "read") : hits[0];
    if (hit) return hit;
  }
  return null;
}

async function readOne(ctx: IntentCtx, key: HintKey, missing: string): Promise<IntentResult> {
  const { endpoints, stale, ageSec, ok } = await catalogue(ctx);
  if (!endpoints.length) {
    return { ok: false, speech: ok ? "Der Pi meldet noch keine Werte." : "Der Pi ist nicht erreichbar." };
  }
  const ep = pick(endpoints, key);
  if (!ep) return { ok: false, speech: missing };
  return { ok: true, speech: summarize([ep], stale, ageSec), detail: ep };
}

async function setOne(
  ctx: IntentCtx,
  key: HintKey,
  value: string | number | boolean,
  missing: string,
): Promise<IntentResult> {
  if (ctx.allowControl === false) return { ok: false, speech: "Dieser Zugang darf nichts schalten." };
  const { endpoints } = await catalogue(ctx);
  const ep = pick(endpoints, key, { writable: true });
  if (!ep) return { ok: false, speech: missing };
  const out = await relayInvoke(ep.id, value, ctx.source);
  if (!out.ok) {
    return {
      ok: false,
      speech:
        out.error === "pi_not_configured"
          ? "Der Pi ist noch nicht mit der Cloud verbunden."
          : `Konnte ${ep.label || ep.id} nicht schalten, der Pi antwortet nicht.`,
    };
  }
  const shown =
    typeof value === "boolean" ? (value ? "an" : "aus") : `${value}${ep.unit ? ` ${ep.unit}` : ""}`;
  return { ok: true, speech: `${ep.label || ep.id}: ${shown}.`, detail: out.result };
}

// -------------------------------------------------------- generic endpoints
/** Full catalogue as speech (used by "/endpoints" and Alexa's list intent). */
export async function endpointList(ctx?: IntentCtx): Promise<IntentResult> {
  const c = ctx ?? { source: "chat" as IntentSource };
  return turn(c, "endpunkte", null, async () => {
    const { endpoints, stale, ageSec, ok } = await catalogue(c);
    if (!endpoints.length) {
      return {
        ok: false,
        speech: ok ? "Der Pi meldet noch keine Endpunkte." : "Der Pi ist nicht erreichbar.",
      };
    }
    return { ok: true, speech: summarize(endpoints, stale, ageSec), detail: endpoints };
  });
}

/** Read one endpoint (or everything when no name is given). */
export async function endpointStatus(ctx: IntentCtx, query?: string): Promise<IntentResult> {
  return turn(ctx, `status ${query ?? "alles"}`, query, () => statusOf(query, ctx.source));
}

/** Set one endpoint by name. */
export async function endpointSet(
  ctx: IntentCtx,
  query: string,
  value: string | number | boolean,
): Promise<IntentResult> {
  return turn(ctx, `setze ${query}`, value, () =>
    invoke(
      {
        source: ctx.source === "alexa" ? "alexa" : ctx.source === "telegram" ? "telegram" : "chat",
        allowControl: ctx.allowControl,
      },
      query,
      value,
    ),
  );
}

// ------------------------------------------------- pump, irrigation, system
export async function pumpOn(ctx: IntentCtx, minutes?: number): Promise<IntentResult> {
  return turn(ctx, "pumpe an", minutes, async () => {
    const m = Math.max(1, Math.min(120, Number.isFinite(minutes as number) ? (minutes as number) : 10));
    const { endpoints } = await catalogue(ctx);
    const irrigation = pick(endpoints, "irrigation", { writable: true });
    if (irrigation) {
      const out = await relayInvoke(irrigation.id, m, ctx.source);
      if (out.ok) return { ok: true, speech: `Bewässerung läuft für ${m} Minuten.`, detail: out.result };
    }
    const pump = pick(endpoints, "pump", { writable: true });
    if (!pump) return { ok: false, speech: "Ich finde keinen Pumpen-Endpunkt in Node-RED." };
    const out = await relayInvoke(pump.id, true, ctx.source);
    if (!out.ok) {
      return {
        ok: false,
        speech:
          out.error === "pi_not_configured"
            ? "Der Pi ist noch nicht mit der Cloud verbunden."
            : "Konnte die Pumpe nicht einschalten, der Pi antwortet nicht.",
      };
    }
    return { ok: true, speech: "Pumpe an.", detail: out.result };
  });
}

export async function pumpOff(ctx: IntentCtx): Promise<IntentResult> {
  return turn(ctx, "pumpe aus", null, async () => {
    const { endpoints } = await catalogue(ctx);
    const pump = pick(endpoints, "pump", { writable: true });
    if (!pump) return { ok: false, speech: "Ich finde keinen Pumpen-Endpunkt in Node-RED." };
    const out = await relayInvoke(pump.id, false, ctx.source);
    if (!out.ok) return { ok: false, speech: "Konnte die Pumpe nicht ausschalten." };
    return { ok: true, speech: "Pumpe aus.", detail: out.result };
  });
}

export async function pumpStatus(ctx: IntentCtx): Promise<IntentResult> {
  return turn(ctx, "pumpenstatus", null, async () => {
    const { endpoints, stale, ageSec } = await catalogue(ctx);
    const list = endpoints.filter(
      (e) =>
        HINTS.pump.some((h) => e.id.toLowerCase().includes(h)) ||
        HINTS.runtime.some((h) => e.id.toLowerCase().includes(h)),
    );
    if (!list.length) return { ok: false, speech: "Ich finde keinen Pumpen-Endpunkt." };
    return { ok: true, speech: summarize(list, stale, ageSec), detail: list };
  });
}

export async function irrigationStart(ctx: IntentCtx, minutes?: number): Promise<IntentResult> {
  return pumpOn(ctx, minutes);
}

export async function nightQuiet(ctx: IntentCtx, on?: boolean): Promise<IntentResult> {
  if (on === undefined) {
    return turn(ctx, "nachtruhe", null, () => readOne(ctx, "night", "Es gibt keine Nachtruhe-Schaltung."));
  }
  return turn(ctx, `nachtruhe ${on ? "an" : "aus"}`, on, () =>
    setOne(ctx, "night", on, "Es gibt keine Nachtruhe-Schaltung."),
  );
}

export async function strategy(ctx: IntentCtx, name?: string): Promise<IntentResult> {
  if (!name) {
    return turn(ctx, "strategie", null, () => readOne(ctx, "strategy", "Es gibt keine Strategie-Auswahl."));
  }
  return turn(ctx, `strategie ${name}`, name, () =>
    setOne(ctx, "strategy", name, "Es gibt keine Strategie-Auswahl."),
  );
}

export async function rainForecast(ctx: IntentCtx): Promise<IntentResult> {
  return turn(ctx, "regen", null, () => readOne(ctx, "rain", "Es gibt keinen Regen-Wert."));
}

export async function surplusNow(ctx: IntentCtx): Promise<IntentResult> {
  return turn(ctx, "überschuss", null, () => readOne(ctx, "surplus", "Es gibt keinen Überschuss-Wert."));
}

export async function systemStatus(ctx: IntentCtx): Promise<IntentResult> {
  return turn(ctx, "systemstatus", null, async () => {
    const { endpoints, stale, ageSec, ok } = await catalogue(ctx);
    if (!endpoints.length) {
      return { ok: false, speech: ok ? "Der Pi meldet noch keine Werte." : "Der Pi ist nicht erreichbar." };
    }
    const sys = endpoints.filter((e) => /cpu|mem|ram|temp|disk|uptime|broker/i.test(e.id));
    return { ok: true, speech: summarize(sys.length ? sys : endpoints, stale, ageSec) };
  });
}

export async function energyPriceNow(ctx: IntentCtx): Promise<IntentResult> {
  return turn(ctx, "strompreis", null, async () => {
    const { endpoints, stale, ageSec } = await catalogue(ctx);
    const ep = pick(endpoints, "price");
    if (!ep || ep.value == null) return { ok: true, speech: "Kein aktueller Strompreis verfügbar." };
    const v = typeof ep.value === "number" ? ep.value.toFixed(1) : String(ep.value);
    return {
      ok: true,
      speech: `Strom kostet gerade ${v} ${ep.unit ?? "Cent pro Kilowattstunde"}${stale ? ` (Stand ${describeAge(ageSec)})` : ""}.`,
      detail: ep,
    };
  });
}

export async function mqttPublish(
  ctx: IntentCtx,
  topic: string,
  payload: string,
): Promise<IntentResult> {
  return turn(ctx, `mqtt ${topic}`, payload, async () => {
    if (!/^cmnd\/[a-z0-9_\-/]+$/i.test(topic)) {
      return { ok: false, speech: `Topic ${topic} nicht erlaubt.` };
    }
    const { endpoints } = await catalogue(ctx);
    const ep = endpoints.find((e) => e.id === "mqtt_publish" || /mqtt/i.test(e.id));
    if (!ep) return { ok: false, speech: "Node-RED bietet keinen MQTT-Endpunkt an." };
    const out = await relayInvoke(ep.id, `${topic} ${payload}`, ctx.source);
    if (!out.ok) return { ok: false, speech: "MQTT-Kommando fehlgeschlagen." };
    return { ok: true, speech: `MQTT ${topic} gesendet.`, detail: out.result };
  });
}

// ---------------------------------------------------------- free text router
const num = (t: string) => {
  const m = t.match(/(\d{1,3})\s*(min|minuten|minute)?/i);
  return m ? Number(m[1]) : undefined;
};

/**
 * Cheap keyword router used by Telegram free text, Alexa's free question intent
 * and the Debug simulator. Returns null when nothing matched — callers then ask
 * the AI brain.
 */
export async function routeText(ctx: IntentCtx, raw: string): Promise<IntentResult | null> {
  const t = raw.toLowerCase().trim();
  if (!t) return null;

  const on = /(an|ein|start|aktivier|on\b|los)/.test(t);
  const off = /(aus|stop|beend|deaktivier|off\b)/.test(t);

  if (/(bewäss|bewaess|giess|gieß|irrigation)/.test(t) && !off) return irrigationStart(ctx, num(t));
  if (/(pumpe|pump|zisterne)/.test(t)) {
    if (off) return pumpOff(ctx);
    if (on) return pumpOn(ctx, num(t));
    return pumpStatus(ctx);
  }
  if (/(nachtruhe|nachts ruhe|quiet)/.test(t)) {
    if (on) return nightQuiet(ctx, true);
    if (off) return nightQuiet(ctx, false);
    return nightQuiet(ctx);
  }
  if (/strateg/.test(t)) {
    const m = t.match(/strategie\s*(?:auf|=)?\s*(automatik|überschuss|ueberschuss|immer|aus)/);
    return strategy(ctx, m?.[1]);
  }
  if (/regen/.test(t)) return rainForecast(ctx);
  if (/(überschuss|ueberschuss|pv|solar)/.test(t)) return surplusNow(ctx);
  if (/(preis|strompreis|tibber|kostet)/.test(t)) return energyPriceNow(ctx);
  if (/(endpunkt|endpoints|was kannst du|welche werte)/.test(t)) return endpointList(ctx);
  if (/(status|zustand|wie geht|läuft alles|cpu|speicher|temperatur)/.test(t)) {
    return systemStatus(ctx);
  }
  return null;
}

/** A Pi-Control install talks to exactly one Pi, configured through PIHUB_PI_URL. */
export async function resolveDefaultDevice(): Promise<string | null> {
  const { piConfig } = await import("@/lib/pi-relay.server");
  return piConfig().configured ? "pi" : null;
}

export { findEndpoint, readEndpoints };
