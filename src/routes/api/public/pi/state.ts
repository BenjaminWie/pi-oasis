// Pi-side read endpoint for the cloud relay (and for any external caller with
// the device token). Database-free: everything comes from the local 48h store
// plus a live system snapshot.
//
// Auth: Bearer PI_INGEST_TOKEN, or a signed Pi dashboard token.
import { createFileRoute } from "@tanstack/react-router";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

export const Route = createFileRoute("/api/public/pi/state")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const denied = guardLocalIngest(request);
        if (denied) {
          return Response.json({ error: denied }, { status: 401, headers: CORS });
        }

        const { recentRows, localStorageInfo } = await import("@/lib/local-timeseries.server");
        const ticks = recentRows("tick", 1);
        const events = recentRows("event", 20);
        const lastTick = (ticks[0] ?? {}) as Record<string, unknown>;

        let system: unknown = null;
        try {
          const { hasProcStats } = await import("@/lib/pi-runtime.server");
          if (hasProcStats()) {
            const { readRealSystemStats } = await import("@/lib/system.server");
            system = await readRealSystemStats();
          }
        } catch {
          /* system stats are best-effort */
        }

        return Response.json(
          {
            ts: (lastTick.ts as string) ?? new Date().toISOString(),
            ...lastTick,
            system,
            recent_events: events,
            storage: localStorageInfo(),
          },
          { headers: { ...CORS, "cache-control": "no-store" } },
        );
      },
    },
  },
});
