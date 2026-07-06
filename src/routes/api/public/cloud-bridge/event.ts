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

        const rows = events.map((e) => {
          // Keep Node-RED flexible while preserving one canonical `watts` key
          // for hourly rollups and AI reasoning. Existing flows often emit
          // `watt` (Tasmota) or `house_power` (Tibber Pulse).
          const metrics = { ...((e.metrics ?? {}) as Record<string, unknown>) };
          const watts = metrics.watt ?? metrics.house_power;
          if (metrics.watts == null && watts != null) metrics.watts = watts;
          return {
            device_id: device.id,
            component: e.component,
            device_label: e.device ?? "",
            status: e.status,
            message: e.message ?? null,
            strategy_applied: e.strategy_applied ?? null,
            metrics: metrics as any,
            occurred_at: e.ts ?? new Date().toISOString(),
          };
        });

        // Server-side dedup: collapse consecutive heartbeats with the same
        // (component, device_label, status) and ~equal watts (±5W) inside a
        // 5-minute window into a single row (update occurred_at, bump sample_count).
        // Rows on state change, warning/critical, or gap > 5 min still insert.
        let inserted = 0;
        let deduped = 0;
        for (const row of rows) {
          const { data: last } = await (supabaseAdmin as any)
            .from("device_events")
            .select("id, occurred_at, status, metrics, sample_count")
            .eq("device_id", row.device_id)
            .eq("component", row.component)
            .eq("device_label", row.device_label)
            .order("occurred_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const wattsNew = Number((row.metrics as any)?.watts ?? NaN);
          const wattsOld = Number(last?.metrics?.watts ?? NaN);
          const wattsMatch =
            (Number.isNaN(wattsNew) && Number.isNaN(wattsOld)) ||
            (Number.isFinite(wattsNew) &&
              Number.isFinite(wattsOld) &&
              Math.abs(wattsNew - wattsOld) <= 5);
          const gapMs = last ? Date.now() - new Date(last.occurred_at).getTime() : Infinity;
          const canDedup =
            last &&
            last.status === row.status &&
            row.status !== "warning" &&
            row.status !== "critical" &&
            wattsMatch &&
            gapMs < 5 * 60_000;

          if (canDedup) {
            await (supabaseAdmin as any)
              .from("device_events")
              .update({
                occurred_at: row.occurred_at,
                sample_count: (last.sample_count ?? 1) + 1,
              })
              .eq("id", last.id);
            deduped++;
          } else {
            const { error } = await supabaseAdmin.from("device_events").insert(row);
            if (error) return jsonResponse({ error: error.message }, 500);
            inserted++;
          }
        }

        return jsonResponse({ ok: true, inserted, deduped });
      },
    },
  },
});
