// Stateless live-relay: Node-RED (or the Pi bridge) POSTs a tick here and we
// re-broadcast it on Supabase Realtime channel `live:<device_id>`.
// NO database inserts happen here — the DB stays asleep. Browsers subscribe
// directly to the broadcast channel over WebSocket.
//
// Auth: Bearer = device_token (hashed match against devices.device_token_hash).
// Rate-limit: max 2 msg/s per device (in-memory in the Worker).
//
// Body (single or array, max 20):
//   { watts?, pv_surplus_w?, outside_temp_c?, pump_on?, strategy_applied?, ts? }
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { bearer, jsonResponse, sha256 } from "@/lib/agent-api.server";

const Tick = z.object({
  watts: z.number().finite().optional(),
  pv_surplus_w: z.number().finite().optional(),
  outside_temp_c: z.number().finite().optional(),
  rain_next_24h_mm: z.number().finite().optional(),
  pump_on: z.boolean().optional(),
  strategy_applied: z.string().max(64).optional(),
  reason: z.string().max(256).optional(),
  ts: z.string().datetime().optional(),
});
const Body = z.union([Tick, z.array(Tick).min(1).max(20)]);

const lastEmit = new Map<string, number>();

export const Route = createFileRoute("/api/public/live/publish")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type",
          },
        }),
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse({ error: "no token" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: device } = await supabaseAdmin
          .from("devices")
          .select("id")
          .eq("device_token_hash", sha256(token))
          .maybeSingle();
        if (!device) return jsonResponse({ error: "unknown device" }, 401);

        // Rate limit: 500ms per device
        const now = Date.now();
        const prev = lastEmit.get(device.id) ?? 0;
        if (now - prev < 500) return jsonResponse({ ok: true, throttled: true });
        lastEmit.set(device.id, now);

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ error: "invalid body", detail: String(e?.message ?? e) }, 400);
        }
        const ticks = Array.isArray(parsed) ? parsed : [parsed];
        const tick = ticks[ticks.length - 1]; // send only the newest

        // Send via Supabase Realtime Broadcast HTTP endpoint.
        // https://supabase.com/docs/guides/realtime/broadcast#send-messages-using-rest-calls
        const url = `${process.env.SUPABASE_URL}/realtime/v1/api/broadcast`;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
        try {
          await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: key,
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              messages: [
                {
                  topic: `live:${device.id}`,
                  event: "tick",
                  payload: { ...tick, ts: tick.ts ?? new Date().toISOString() },
                  private: false,
                },
              ],
            }),
          });
        } catch (e: any) {
          return jsonResponse({ error: "broadcast failed", detail: String(e?.message ?? e) }, 502);
        }

        return jsonResponse({ ok: true }, {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      },
    },
  },
});
