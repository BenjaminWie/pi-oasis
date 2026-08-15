// Pi-side command endpoint for the cloud relay. Executes exactly the same
// command kinds the old cloud bridge pulled from the database — but directly,
// synchronously and without any queue table.
//
// Auth: Bearer PI_INGEST_TOKEN, or a signed Pi dashboard token.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const ALLOWED = [
  "status",
  "container_action",
  "mqtt_publish",
  "terminal",
  "plugin_list",
  "plugin_get",
  "plugin_run_planner",
  "plugin_manual",
] as const;

const Body = z.object({
  kind: z.enum(ALLOWED),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export const Route = createFileRoute("/api/public/pi/command")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const denied = guardLocalIngest(request);
        if (denied) return Response.json({ error: denied }, { status: 401, headers: CORS });

        let body;
        try {
          body = Body.parse(await request.json());
        } catch (e: any) {
          return Response.json(
            { error: "invalid body", detail: String(e?.message ?? e) },
            { status: 400, headers: CORS },
          );
        }

        const { execCommand } = await import("@/lib/cloud-bridge.server");
        const out = await execCommand({ kind: body.kind, payload: body.payload });

        // Keep the local 48h history honest about remote-triggered actions.
        try {
          const { appendLocalRows } = await import("@/lib/local-timeseries.server");
          const { publishLocalBus } = await import("@/lib/local-live-bus.server");
          const row = {
            component: "relay_command",
            status: out.ok ? "info" : "error",
            message: body.kind,
            metrics: body.payload,
          };
          appendLocalRows("event", [row]);
          publishLocalBus("event", row);
        } catch {
          /* history is best-effort */
        }

        return Response.json(out, { status: out.ok ? 200 : 502, headers: CORS });
      },
    },
  },
});
