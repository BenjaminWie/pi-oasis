import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/anomaly-scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { error: baselineErr } = await (supabaseAdmin as any).rpc("recompute_anomaly_baselines");
        if (baselineErr) console.error("[anomaly-scan] baseline error", baselineErr.message);

        // Scan every device with recent activity (last 24h).
        const since = new Date(Date.now() - 86_400_000).toISOString();
        const { data: recent } = await (supabaseAdmin as any)
          .from("device_events")
          .select("device_id")
          .gte("occurred_at", since)
          .limit(1000);
        const deviceIds = Array.from(new Set(((recent ?? []) as any[]).map((r) => r.device_id)));

        let alertsWritten = 0;
        for (const deviceId of deviceIds) {
          const { data: rows, error: detectErr } = await (supabaseAdmin as any).rpc("detect_pump_anomalies", {
            _device_id: deviceId,
            _window_minutes: 60,
          });
          if (detectErr) {
            console.error("[anomaly-scan] detect error", deviceId, detectErr.message);
            continue;
          }
          for (const row of (rows ?? []) as Array<{ kind: string; severity: string; count: number; payload: any }>) {
            await (supabaseAdmin as any).rpc("upsert_alert", {
              _device_id: deviceId,
              _kind: row.kind,
              _severity: row.severity,
              _count: row.count,
              _payload: row.payload ?? {},
            });
            alertsWritten += 1;
          }
        }

        return new Response(JSON.stringify({ ok: true, scanned: deviceIds.length, alertsWritten }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
