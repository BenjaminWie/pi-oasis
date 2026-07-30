// Bootstrap endpoint for the Pi's WebSocket command channel.
//
// The Pi calls this ONCE per boot with its device token and gets back the
// public Supabase URL + publishable key plus its channel name. It then holds a
// single Realtime WebSocket and never polls again (except the 15-min safety
// net). Only the publishable (anon) key is returned — never the service role.

import { createFileRoute } from "@tanstack/react-router";
import { bearer, jsonResponse, sha256 } from "@/lib/agent-api.server";

export const Route = createFileRoute("/api/public/agent/realtime")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse({ error: "no token" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("id")
          .eq("device_token_hash", sha256(token))
          .maybeSingle();
        if (!device) return jsonResponse({ error: "unknown device" }, 401);

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey =
          process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseKey) {
          return jsonResponse({ error: "realtime not configured" }, 503);
        }

        return jsonResponse({
          supabaseUrl,
          supabaseKey,
          deviceId: device.id,
          channel: `commands:${device.id}`,
          safetyNetPollMs: 15 * 60_000,
        });
      },
    },
  },
});
