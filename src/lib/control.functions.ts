// Server functions for analytics & strategy (cloud-only).
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listDeviceEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      deviceId: z.string().uuid(),
      limit: z.number().int().min(1).max(500).default(100),
      component: z.string().optional(),
      status: z.string().optional(),
      sinceIso: z.string().datetime().optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    // RLS ensures only owner can see
    let q = context.supabase
      .from("device_events")
      .select("id, occurred_at, component, device_label, status, message, strategy_applied, metrics")
      .eq("device_id", data.deviceId)
      .order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (data.component) q = q.eq("component", data.component);
    if (data.status) q = q.eq("status", data.status);
    if (data.sinceIso) q = q.gte("occurred_at", data.sinceIso);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listEventBuckets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      deviceId: z.string().uuid(),
      sinceIso: z.string().datetime().optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const since = data.sinceIso ?? new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("device_events_hourly")
      .select(
        "bucket, component, status, event_count, watts_avg, watts_max, watts_min, temp_avg, rain_sum, pv_surplus_avg, pumping_allowed_ratio",
      )
      .eq("device_id", data.deviceId)
      .gte("bucket", since)
      .order("bucket", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getStrategy = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ deviceId: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("strategy_profiles")
      .select("params, eco_paused, updated_at")
      .eq("device_id", data.deviceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row ?? { params: {}, eco_paused: false, updated_at: null };
  });

const paramsSchema = z.object({
  pv_min_w: z.number().min(0).max(10000).optional(),
  tibber_max_ct: z.number().min(0).max(200).optional(),
  heat_start_hour: z.number().int().min(0).max(23).optional(),
  heat_end_hour: z.number().int().min(0).max(23).optional(),
  run_minutes: z.number().int().min(1).max(180).optional(),
  max_minutes_per_day: z.number().int().min(1).max(720).optional(),
  rain_veto_mm: z.number().min(0).max(50).optional(),
});

export const upsertStrategy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      deviceId: z.string().uuid(),
      params: paramsSchema.optional(),
      ecoPaused: z.boolean().optional(),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {
      device_id: data.deviceId,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    };
    if (data.params) patch.params = data.params;
    if (typeof data.ecoPaused === "boolean") patch.eco_paused = data.ecoPaused;

    const { error } = await context.supabase
      .from("strategy_profiles")
      .upsert(patch as any, { onConflict: "device_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAnomalies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ deviceId: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("anomaly_baselines")
      .select("metric, mean, stddev, sample_count, window_days, updated_at")
      .eq("device_id", data.deviceId);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
