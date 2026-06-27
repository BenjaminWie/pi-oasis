// Node-RED polls this with the device's bearer token to get current strategy
// params (PV threshold, Tibber cap, heat window, etc.) + eco_paused flag.
import { createFileRoute } from "@tanstack/react-router";
import { bearer, jsonResponse, sha256 } from "@/lib/agent-api.server";

const DEFAULTS = {
  pv_min_w: 300,
  tibber_max_ct: 30,
  heat_start_hour: 11,
  heat_end_hour: 16,
  run_minutes: 10,
  max_minutes_per_day: 30,
  rain_veto_mm: 0.1,
};

export const Route = createFileRoute("/api/public/cloud-bridge/strategy")({
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

        const { data: profile } = await supabaseAdmin
          .from("strategy_profiles")
          .select("params, eco_paused, updated_at")
          .eq("device_id", device.id)
          .maybeSingle();

        return jsonResponse({
          params: { ...DEFAULTS, ...((profile?.params as any) ?? {}) },
          eco_paused: !!profile?.eco_paused,
          updated_at: profile?.updated_at ?? null,
        });
      },
    },
  },
});
