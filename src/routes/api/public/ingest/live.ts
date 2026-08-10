// Local live-tick ingest (Pi-only). Mirrors /api/public/live/publish but keeps
// everything on the Pi: 48h JSONL storage + instant SSE fanout to open tabs.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requestId, tracedResponse } from "@/lib/agent-api.server";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const Tick = z
  .object({
    watts: z.number().finite().optional(),
    pv_surplus_w: z.number().finite().optional(),
    outside_temp_c: z.number().finite().optional(),
    rain_next_24h_mm: z.number().finite().optional(),
    pump_on: z.boolean().optional(),
    strategy_applied: z.string().max(64).optional(),
    reason: z.string().max(256).optional(),
    cpu_pct: z.number().finite().optional(),
    mem_pct: z.number().finite().optional(),
    disk_pct: z.number().finite().optional(),
    swap_pct: z.number().finite().optional(),
    temp_c: z.number().finite().optional(),
    uptime_s: z.number().finite().optional(),
    mqtt_broker_up: z.boolean().optional(),
    ts: z.string().datetime().optional(),
  })
  .passthrough();

const Body = z.union([Tick, z.array(Tick).min(1).max(20)]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
  "Access-Control-Expose-Headers": "x-request-id",
};

export const Route = createFileRoute("/api/public/ingest/live")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const rid = requestId(request);
        const respond = (body: any, status = 200) =>
          tracedResponse(rid)(body, { status, headers: CORS });

        const denied = guardLocalIngest(request);
        if (denied) return respond({ error: denied }, denied === "unauthorized" ? 401 : 403);

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e: any) {
          return respond({ error: "invalid body", detail: String(e?.message ?? e) }, 400);
        }
        const now = new Date().toISOString();
        const ticks = (Array.isArray(parsed) ? parsed : [parsed]).map((t) => ({
          ...t,
          ts: t.ts ?? now,
        }));

        const { appendLocalRows } = await import("@/lib/local-timeseries.server");
        const { publishLocalBus } = await import("@/lib/local-live-bus.server");
        const stored = appendLocalRows("tick", ticks);
        for (const t of ticks) publishLocalBus("tick", t);

        return respond({
          ok: true,
          received: ticks.length,
          stored,
          downsampled: ticks.length - stored,
          storage: "local-jsonl-48h",
        });
      },
    },
  },
});
