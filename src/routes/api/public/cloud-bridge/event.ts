// Direct ingest from Node-RED on the Pi (or any device with its token).
// Auth: Bearer = device_token (HMAC-hashed in devices.device_token_hash).
// Body: { component, device?, status, message?, strategy_applied?, metrics?, ts? }
// Single event or array (max 50).
//
// Zero-Wake: the whole batch (dedup + insert + device_state_latest mirror +
// pump_sessions write-back) runs inside ONE Postgres call
// (`ingest_device_events`), so the database wakes once per request instead of
// 2–3 roundtrips per event.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { bearer, jsonResponse, sha256 } from "@/lib/agent-api.server";

const Single = z.object({
  component: z.string().min(1).max(64),
  device: z.string().max(64).optional(),
  status: z.string().min(1).max(32),
  message: z.string().max(2048).optional(),
  strategy_applied: z.string().max(64).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  ts: z.string().datetime().optional(),
});

const Body = z.union([Single, z.array(Single).min(1).max(50)]);

// token hash -> device id, cached per worker isolate so repeated ingests do
// not hit Postgres just to resolve the device.
const DEVICE_CACHE_MS = 10 * 60_000;
const deviceCache = new Map<string, { id: string; at: number }>();

export const Route = createFileRoute("/api/public/cloud-bridge/event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return jsonResponse({ error: "no token" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const hash = sha256(token);
        const now = Date.now();
        const cached = deviceCache.get(hash);
        let deviceId = cached && now - cached.at < DEVICE_CACHE_MS ? cached.id : null;
        if (!deviceId) {
          const { data: device } = await supabaseAdmin
            .from("devices")
            .select("id")
            .eq("device_token_hash", hash)
            .maybeSingle();
          if (!device) return jsonResponse({ error: "unknown device" }, 401);
          deviceId = device.id;
          deviceCache.set(hash, { id: device.id, at: now });
        }

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ error: "invalid body", detail: String(e?.message ?? e) }, 400);
        }
        const events = Array.isArray(parsed) ? parsed : [parsed];

        const payload = events.map((e) => ({
          component: e.component,
          device: e.device ?? "",
          status: e.status,
          message: e.message ?? null,
          strategy_applied: e.strategy_applied ?? null,
          metrics: e.metrics ?? {},
          ts: e.ts ?? new Date().toISOString(),
        }));

        const { data, error } = await (supabaseAdmin as any).rpc("ingest_device_events", {
          _device_id: deviceId,
          _events: payload,
        });
        if (error) return jsonResponse({ error: error.message }, 500);

        return jsonResponse({
          ok: true,
          inserted: (data as any)?.inserted ?? 0,
          deduped: (data as any)?.deduped ?? 0,
        });
      },
    },
  },
});
