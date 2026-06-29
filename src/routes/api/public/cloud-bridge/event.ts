// Direct ingest from Node-RED on the Pi (or any device with its token).
// Auth: Bearer = device_token (HMAC-hashed in devices.device_token_hash).
// Body: { component, device?, status, message?, strategy_applied?, metrics?, ts? }
// Single event or array (max 50).
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

export const Route = createFileRoute("/api/public/cloud-bridge/event")({
  server: {
    handlers: {
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

        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch (e: any) {
          return jsonResponse({ error: "invalid body", detail: String(e?.message ?? e) }, 400);
        }
        const events = Array.isArray(parsed) ? parsed : [parsed];

        const rows = events.map((e) => ({
          // Keep Node-RED flexible while preserving one canonical `watts` key
          // for hourly rollups and AI reasoning. Existing flows often emit
          // `watt` (Tasmota) or `house_power` (Tibber Pulse).
          ...(() => {
            const metrics = { ...((e.metrics ?? {}) as Record<string, unknown>) };
            if (metrics.watts == null) metrics.watts = metrics.watt ?? metrics.house_power;
            return { _metrics: metrics } as any;
          })(),
          device_id: device.id,
          component: e.component,
          device_label: e.device ?? "",
          status: e.status,
          message: e.message ?? null,
          strategy_applied: e.strategy_applied ?? null,
          metrics: undefined as any,
          occurred_at: e.ts ?? new Date().toISOString(),
        })).map(({ _metrics, ...row }: any) => ({ ...row, metrics: _metrics }));

        const { error } = await supabaseAdmin.from("device_events").insert(rows);
        if (error) return jsonResponse({ error: error.message }, 500);

        return jsonResponse({ ok: true, inserted: rows.length });
      },
    },
  },
});
