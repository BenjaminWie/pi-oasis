// AI tools for the cloud assistant, Telegram and Alexa.
//
// There is no fixed tool list any more: the Pi announces its endpoints, the
// cloud reads that catalogue through the relay and hands the model three
// generic tools. A new switch in Node-RED is therefore usable by voice and by
// the assistant without any code change here.

import { describeAge, getPiEndpoints, relayInvoke, type RelayEndpoint } from "./pi-relay.server";

export interface ToolCtx {
  userId?: string;
  source: "chat" | "telegram" | "alexa";
  /** false → read-only (no switching) */
  allowControl?: boolean;
}

export async function readEndpoints(via?: string): Promise<{
  endpoints: RelayEndpoint[];
  stale: boolean;
  ageSec: number | null;
  ok: boolean;
  error?: string;
}> {
  const r = await getPiEndpoints(via);
  return {
    endpoints: r.data?.endpoints ?? [],
    stale: r.stale,
    ageSec: r.ageSec,
    ok: r.ok,
    error: r.error,
  };
}

export function summarize(endpoints: RelayEndpoint[], stale: boolean, ageSec: number | null) {
  const parts = endpoints
    .filter((e) => e.value !== null && e.value !== undefined)
    .map((e) => {
      const v =
        typeof e.value === "boolean"
          ? e.value
            ? "an"
            : "aus"
          : typeof e.value === "number"
            ? `${Math.round(e.value * 10) / 10}${e.unit ? ` ${e.unit}` : ""}`
            : String(e.value);
      return `${e.label || e.id}: ${v}`;
    });
  if (!parts.length) return "Der Pi meldet gerade keine Werte.";
  return parts.join(", ") + (stale ? ` (Stand ${describeAge(ageSec)})` : "") + ".";
}

export function findEndpoint(endpoints: RelayEndpoint[], query: string): RelayEndpoint | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    endpoints.find((e) => e.id.toLowerCase() === q) ||
    endpoints.find((e) => (e.label ?? "").toLowerCase() === q) ||
    endpoints.find((e) => e.id.toLowerCase().includes(q) || (e.label ?? "").toLowerCase().includes(q)) ||
    null
  );
}

export async function invoke(
  ctx: ToolCtx,
  query: string,
  value: string | number | boolean,
): Promise<{ ok: boolean; speech: string; detail?: unknown }> {
  if (ctx.allowControl === false) {
    return { ok: false, speech: "Dieser Zugang darf nichts schalten." };
  }
  const { endpoints, ok } = await readEndpoints(ctx.source);
  if (!ok && !endpoints.length) return { ok: false, speech: "Der Pi ist nicht erreichbar." };
  const ep = findEndpoint(endpoints, query);
  if (!ep) return { ok: false, speech: `Ich kenne keinen Endpunkt "${query}".` };
  if (ep.kind === "read") return { ok: false, speech: `${ep.label || ep.id} kann man nur lesen.` };
  if (ep.control === false) {
    return { ok: false, speech: `${ep.label || ep.id} ist zum Schalten gesperrt.` };
  }
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
  return { ok: true, speech: `${ep.label || ep.id} auf ${shown} gesetzt.`, detail: out.result };
}

export async function statusOf(
  query?: string,
  via?: string,
): Promise<{ ok: boolean; speech: string }> {
  const { endpoints, stale, ageSec, ok } = await readEndpoints(via);
  if (!endpoints.length) {
    return {
      ok: false,
      speech: ok ? "Der Pi meldet noch keine Endpunkte." : "Der Pi ist nicht erreichbar.",
    };
  }
  if (query) {
    const ep = findEndpoint(endpoints, query);
    if (!ep) return { ok: false, speech: `Ich kenne keinen Endpunkt "${query}".` };
    return { ok: true, speech: summarize([ep], stale, ageSec) };
  }
  return { ok: true, speech: summarize(endpoints, stale, ageSec) };
}
