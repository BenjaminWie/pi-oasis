// Self-configuration endpoint for Node-RED. LAN-only, or bearer PI_INGEST_TOKEN
// when that env var is set (same guard as the local ingest routes).
// The flow calls this on deploy + every 30 min and stores the result in
// global.pihub — so no token ever has to be pasted into Node-RED by hand.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/nodered/config")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { guardLocalIngest } = await import("@/lib/local-ingest-guard.server");
        const denied = guardLocalIngest(request);
        if (denied) {
          return new Response(JSON.stringify({ error: denied }), {
            status: denied === "unauthorized" ? 401 : 403,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { buildNodeRedConfig } = await import("@/lib/nodered-config.server");
        const cfg = await buildNodeRedConfig();
        return new Response(JSON.stringify(cfg), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
