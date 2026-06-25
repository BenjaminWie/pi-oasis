// Cloud-side receive endpoint. The Pi's ingest-buffer forwarder POSTs each
// validated event here with the device's bearer token. We authenticate the
// device (same scheme as heartbeat), validate the payload, and insert one row
// into public.device_events. Service-role insert (RLS bypassed); reads stay
// scoped via the SELECT policy.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bearer, jsonResponse, sha256 } from "@/lib/agent-api.server";

const Body = z
  .object({
    component: z.string().min(1).max(64),
    device: z.string().min(1).max(64),
    timestamp: z.string(),
    status: z.enum(["healthy", "warning", "critical", "info"]),
    metrics: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
  })
  .strict();

export const Route = createFileRoute("/api/public/cloud-bridge/event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse({ error: "no token" }, 401);
        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("id")
          .eq("device_token_hash", sha256(token))
          .maybeSingle();
        if (!device) return jsonResponse({ error: "unknown device" }, 401);

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return jsonResponse({ error: "invalid json" }, 400);
        }
        const parsed = Body.safeParse(json);
        if (!parsed.success) {
          return jsonResponse({ error: "invalid payload" }, 400);
        }

        const { error } = await supabaseAdmin.from("device_events").insert({
          device_id: device.id,
          component: parsed.data.component,
          device_label: parsed.data.device,
          status: parsed.data.status,
          metrics: parsed.data.metrics,
          occurred_at: parsed.data.timestamp,
        });
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ ok: true });
      },
    },
  },
});
