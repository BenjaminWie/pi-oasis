// Trace sink for Node-RED. Every push the flow makes (cloud or local) can be
// mirrored here so the Pi dashboard debug panel shows exactly what was sent,
// what came back and what got rejected — even when the cloud is unreachable.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requestId, tracedResponse } from "@/lib/agent-api.server";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const Trace = z
  .object({
    rid: z.string().max(64).optional(),
    route: z.string().max(200).optional(),
    target: z.enum(["cloud", "local", "ws", "other"]).optional(),
    status: z.number().int().nullable().optional(),
    ms: z.number().finite().nullable().optional(),
    ok: z.boolean().optional(),
    reason: z.string().max(500).nullable().optional(),
    events: z.number().int().optional(),
    body: z.unknown().optional(),
    response: z.unknown().optional(),
    ts: z.string().datetime().optional(),
  })
  .passthrough();

const Body = z.union([Trace, z.array(Trace).min(1).max(50)]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
  "Access-Control-Expose-Headers": "x-request-id",
};

function clip(v: unknown, max = 1500) {
  if (v == null) return v;
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + "…" : s;
  } catch {
    return String(v).slice(0, max);
  }
}

export const Route = createFileRoute("/api/public/ingest/trace")({
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
        const rows = (Array.isArray(parsed) ? parsed : [parsed]).map((t) => ({
          ...t,
          ts: t.ts ?? now,
          ok: t.ok ?? (typeof t.status === "number" ? t.status >= 200 && t.status < 300 : true),
          body: clip(t.body),
          response: clip(t.response),
        }));

        const { appendLocalRows } = await import("@/lib/local-timeseries.server");
        const { publishLocalBus } = await import("@/lib/local-live-bus.server");
        const stored = appendLocalRows("trace", rows);
        for (const r of rows) publishLocalBus("trace", r);

        return respond({ ok: true, received: rows.length, stored });
      },
    },
  },
});
