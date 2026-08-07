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
import { bearer, requestId, sha256, tracedResponse } from "@/lib/agent-api.server";

const Tick = z.object({
  // Pump / energy
  watts: z.number().finite().optional(),
  pv_surplus_w: z.number().finite().optional(),
  outside_temp_c: z.number().finite().optional(),
  rain_next_24h_mm: z.number().finite().optional(),
  pump_on: z.boolean().optional(),
  strategy_applied: z.string().max(64).optional(),
  reason: z.string().max(256).optional(),
  // System / Pi telemetry (streamed via live-relay, NOT persisted)
  cpu_pct: z.number().finite().min(0).max(100).optional(),
  mem_pct: z.number().finite().min(0).max(100).optional(),
  disk_pct: z.number().finite().min(0).max(100).optional(),
  swap_pct: z.number().finite().min(0).max(100).optional(),
  temp_c: z.number().finite().optional(),
  uptime_s: z.number().finite().min(0).optional(),
  mqtt_broker_up: z.boolean().optional(),
  ts: z.string().datetime().optional(),
});
const Body = z.union([Tick, z.array(Tick).min(1).max(20)]);

const lastEmit = new Map<string, number>();

// token hash -> device id, cached per worker isolate so a high tick rate does
// not hit Postgres on every message. Correctness still comes from the hash
// comparison on a cache miss.
const DEVICE_CACHE_MS = 10 * 60_000;
const deviceCache = new Map<string, { id: string; at: number }>();
const THROTTLE_MS = Number(process.env.LIVE_PUBLISH_THROTTLE_MS ?? 2000);

// System telemetry mirror throttle: one small upsert per device per 5 min.
const SYS_MIRROR_MS = Number(process.env.LIVE_SYS_MIRROR_MS ?? 5 * 60_000);
const lastSysMirror = new Map<string, number>();


export const Route = createFileRoute("/api/public/live/publish")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "authorization, content-type, x-request-id",
            "Access-Control-Expose-Headers": "x-request-id",
          },
        }),
      POST: async ({ request }) => {
        const rid = requestId(request);
        const respond = (body: any, status = 200) =>
          tracedResponse(rid)(body, {
            status,
            headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "x-request-id" },
          });

        const token = bearer(request);
        if (!token) return respond({ error: "no token" }, 401);

        const hash = sha256(token);
        const now = Date.now();
        const cached = deviceCache.get(hash);
        let deviceId = cached && now - cached.at < DEVICE_CACHE_MS ? cached : undefined;

        if (!deviceId) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: device } = await supabaseAdmin
            .from("devices")
            .select("id")
            .eq("device_token_hash", hash)
            .maybeSingle();
          if (!device) return respond({ error: "unknown device" }, 401);
          deviceId = { id: device.id, at: now };
          deviceCache.set(hash, deviceId);
        }
        const device = { id: deviceId.id };

        // Rate limit (default 2s per device, LIVE_PUBLISH_THROTTLE_MS to tune)
        const prev = lastEmit.get(device.id) ?? 0;
        if (now - prev < THROTTLE_MS)
          return respond({
            ok: true,
            throttled: true,
            broadcast: false,
            system_mirrored: false,
            retry_in_ms: Math.max(0, THROTTLE_MS - (now - prev)),
          });
        lastEmit.set(device.id, now);

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e: any) {
          return respond({ error: "invalid body", detail: String(e?.message ?? e) }, 400);
        }
        const ticks = Array.isArray(parsed) ? parsed : [parsed];
        const tick = ticks[ticks.length - 1]; // send only the newest

        // Persist system telemetry at most once per SYS_MIRROR_MS so the
        // dashboard still shows CPU/RAM/Disk when no browser is listening.
        // One tiny upsert (~1 write / 5 min) instead of device_events rows.
        const sysKeys = [
          "cpu_pct",
          "mem_pct",
          "disk_pct",
          "swap_pct",
          "temp_c",
          "uptime_s",
          "mqtt_broker_up",
        ] as const;
        const sys: Record<string, unknown> = {};
        for (const k of sysKeys) if ((tick as any)[k] != null) sys[k] = (tick as any)[k];
        if (Object.keys(sys).length) {
          const lastSys = lastSysMirror.get(device.id) ?? 0;
          if (now - lastSys >= SYS_MIRROR_MS) {
            lastSysMirror.set(device.id, now);
            try {
              const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
              await (supabaseAdmin as any).rpc("mirror_device_system", {
                _device_id: device.id,
                _sys: sys,
              });
            } catch (e) {
              console.warn("[live] system mirror failed", e);
            }
          }
        }


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
