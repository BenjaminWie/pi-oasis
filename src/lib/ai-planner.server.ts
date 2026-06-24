// AI planner: takes weather + config and emits a watering plan via the
// Lovable AI Gateway. Falls back to a deterministic rule if LOVABLE_API_KEY
// is missing or the call fails.

import type { Plugin, PluginPlan } from "./plugins-store.server";
import { fetchForecast, type WeatherForecast } from "./weather.server";
import { randomBytes } from "node:crypto";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

interface AiPlanShape {
  rationale: string;
  windows: Array<{ startIso: string; endIso: string }>;
  abortIfRainMmNext6h?: number;
}

function ruleBasedPlan(plugin: Plugin, w: WeatherForecast): AiPlanShape {
  const cfg = plugin.config;
  // Skip if heavy rain incoming
  if (w.rainMmNext24h >= 4) {
    return {
      rationale: `Skip — ${w.rainMmNext24h}mm rain forecast in next 24h.`,
      windows: [],
      abortIfRainMmNext6h: 2,
    };
  }
  // Default: early morning watering window
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(5, 0, 0, 0);
  if (start.getTime() < now.getTime()) start.setUTCDate(start.getUTCDate() + 1);
  const end = new Date(start.getTime() + cfg.runMinutes * 60_000);
  return {
    rationale: `Water ${cfg.runMinutes}m at 05:00 UTC — dry forecast (${w.rainMmNext24h}mm/24h, max ${Math.round(w.maxTempCNext24h)}°C).`,
    windows: [{ startIso: start.toISOString(), endIso: end.toISOString() }],
    abortIfRainMmNext6h: 2,
  };
}

async function callAi(plugin: Plugin, w: WeatherForecast): Promise<AiPlanShape | null> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) return null;
  const cfg = plugin.config;
  const sys =
    "You are an irrigation planner. Given a weather forecast and pump config, " +
    "decide when (if at all) to run the pump in the next 24h. Always return strict JSON " +
    "matching: { rationale: string (one sentence, <140 chars), windows: [{startIso, endIso}], " +
    "abortIfRainMmNext6h?: number }. Times are UTC ISO 8601. Prefer early morning (04:00–07:00 UTC). " +
    "Skip entirely (empty windows) if >=4mm rain is forecast in next 24h.";
  const user = JSON.stringify({
    nowIso: new Date().toISOString(),
    config: {
      runMinutes: cfg.runMinutes,
      maxMinutesPerDay: cfg.maxMinutesPerDay,
      minHoursBetweenRuns: cfg.minHoursBetweenRuns,
    },
    weather: {
      rainMmNext6h: w.rainMmNext6h,
      rainMmNext24h: w.rainMmNext24h,
      maxTempCNext24h: w.maxTempCNext24h,
      minTempCNext24h: w.minTempCNext24h,
    },
  });

  const r = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) {
    console.error("[ai-planner] gateway", r.status, await r.text().catch(() => ""));
    return null;
  }
  const j = (await r.json()) as any;
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text) as AiPlanShape;
    if (!Array.isArray(parsed.windows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function buildPlan(plugin: Plugin): Promise<PluginPlan> {
  const cfg = plugin.config;
  const w = await fetchForecast(cfg.lat, cfg.lon).catch((e) => {
    console.error("[ai-planner] weather fetch failed", e);
    return null;
  });
  if (!w) {
    return {
      pluginId: plugin.id,
      createdAt: new Date().toISOString(),
      validUntil: new Date(Date.now() + 3 * 3600_000).toISOString(),
      rationale: "Skip — weather forecast unavailable.",
      windows: [],
      source: "fallback",
    };
  }
  const ai = await callAi(plugin, w);
  const shape = ai ?? ruleBasedPlan(plugin, w);
  return {
    pluginId: plugin.id,
    createdAt: new Date().toISOString(),
    validUntil: new Date(Date.now() + 6 * 3600_000).toISOString(),
    rationale: shape.rationale,
    windows: shape.windows ?? [],
    abortIfRainMmNext6h: shape.abortIfRainMmNext6h,
    source: ai ? "ai" : "fallback",
  };
}

// Re-export so the planner serverFn can attach weather snapshot to decision inputs
export { fetchForecast };
export type { WeatherForecast };
