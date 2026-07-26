// Alerts: read + acknowledge for the signed-in user.
// Anomaly scanning runs in a public cron route (see /api/public/hooks/anomaly-scan.ts).

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("alerts")
      .select("id, device_id, kind, severity, first_seen, last_seen, count, payload, acknowledged_at")
      .is("acknowledged_at", null)
      .order("last_seen", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const acknowledgeAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("alerts")
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: context.userId })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Manual "scan now" — for the device page. Uses admin to bypass RLS on the RPC
// after verifying the device belongs to the caller.
export const scanDeviceAnomalies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { deviceId: string }) =>
    z.object({ deviceId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: dev } = await context.supabase
      .from("devices")
      .select("id")
      .eq("id", data.deviceId)
      .maybeSingle();
    if (!dev) throw new Error("Device not found or not yours");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any).rpc("detect_pump_anomalies", {
      _device_id: data.deviceId,
      _window_minutes: 60,
    });
    if (error) throw new Error(error.message);

    for (const row of (rows ?? []) as Array<{ kind: string; severity: string; count: number; payload: any }>) {
      await (supabaseAdmin as any).rpc("upsert_alert", {
        _device_id: data.deviceId,
        _kind: row.kind,
        _severity: row.severity,
        _count: row.count,
        _payload: row.payload ?? {},
      });
    }
    return { detected: (rows ?? []).length };
  });
