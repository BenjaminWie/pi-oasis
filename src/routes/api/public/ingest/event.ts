// Pi-local Node-RED fallback ingest. Events land in the 48h local time-series
// store (~/.pi-hub/telemetry) plus a RAM buffer, and are pushed live to open
// dashboard tabs. Requires PI_INGEST_TOKEN when set; otherwise LAN-only.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requestId, tracedResponse } from "@/lib/agent-api.server";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const Single = z.object({
  component: z.string().min(1).max(64),
  device: z.string().max(64).optional(),
  status: z.string().min(1).max(32),
  message: z.string().max(2048).optional(),
  strategy_applied: z.string().max(64).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  ts: z.string().datetime().optional(),
});

const Body = z.union([Single, z.array(Single).min(1).max(50)]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
  "Access-Control-Expose-Headers": "x-request-id",
};

export const Route = createFileRoute("/api/public/ingest/event")({
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
        const events = (Array.isArray(parsed) ? parsed : [parsed]).map((e) => ({
          ...e,
          ts: e.ts ?? now,
          receivedAt: now,
          metrics: e.metrics ?? {},
        }));

        const { pushLocalIngest } = await import("@/lib/local-ingest-buffer.server");
        const { appendLocalRows } = await import("@/lib/local-timeseries.server");
        const { publishLocalBus } = await import("@/lib/local-live-bus.server");
        pushLocalIngest(events);
        const stored = appendLocalRows("event", events);
        for (const e of events) publishLocalBus("event", e);

        return respond({
          ok: true,
          received: events.length,
          stored,
          dropped: events.length - stored,
          storage: "local-jsonl-48h",
        });
      },
    },
  },
});
