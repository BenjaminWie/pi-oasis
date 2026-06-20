import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bearer, jsonResponse, sha256 } from "@/lib/agent-api.server";

const Body = z.object({
  cpu: z.number().optional(),
  ram: z.number().optional(),
  temp: z.number().optional(),
  disk: z.number().optional(),
  uptime: z.number().optional(),
  containers: z
    .array(z.object({ name: z.string(), status: z.string(), image: z.string().optional() }))
    .optional(),
  mqtt_brokers: z.array(z.string()).optional(),
});

export const Route = createFileRoute("/api/public/agent/heartbeat")({
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

        let body;
        try {
          body = Body.parse(await request.json());
        } catch {
          return jsonResponse({ error: "invalid body" }, 400);
        }

        await supabaseAdmin
          .from("devices")
          .update({
            last_seen_at: new Date().toISOString(),
            last_snapshot: body,
          })
          .eq("id", device.id);

        return jsonResponse({ ok: true });
      },
    },
  },
});
