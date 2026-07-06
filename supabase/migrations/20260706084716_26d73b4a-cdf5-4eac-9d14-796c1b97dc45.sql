
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.device_events
  ADD COLUMN IF NOT EXISTS sample_count integer NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS device_events_dedup_idx
  ON public.device_events (device_id, component, device_label, occurred_at DESC);

ALTER TABLE public.device_events_hourly
  ADD COLUMN IF NOT EXISTS pump_minutes numeric,
  ADD COLUMN IF NOT EXISTS pump_cycles integer,
  ADD COLUMN IF NOT EXISTS pump_kwh numeric;

CREATE TABLE IF NOT EXISTS public.device_events_daily (
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  day date NOT NULL,
  pump_minutes numeric NOT NULL DEFAULT 0,
  pump_cycles integer NOT NULL DEFAULT 0,
  pump_kwh numeric NOT NULL DEFAULT 0,
  pv_covered_pct numeric,
  rain_mm numeric,
  avg_outside_temp numeric,
  warnings integer NOT NULL DEFAULT 0,
  criticals integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, day)
);

GRANT SELECT ON public.device_events_daily TO authenticated;
GRANT ALL ON public.device_events_daily TO service_role;

ALTER TABLE public.device_events_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner reads device_events_daily" ON public.device_events_daily;
CREATE POLICY "owner reads device_events_daily"
  ON public.device_events_daily
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.devices d
      WHERE d.id = device_events_daily.device_id
        AND d.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.aggregate_device_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.device_events_hourly (
    device_id, bucket, component, status, event_count,
    watts_avg, watts_max, watts_min,
    temp_avg, rain_sum, pv_surplus_avg, pumping_allowed_ratio,
    pump_minutes, pump_cycles, pump_kwh
  )
  SELECT
    device_id,
    date_trunc('hour', occurred_at) AS bucket,
    component,
    status,
    sum(coalesce(sample_count, 1)) AS event_count,
    avg(coalesce((metrics->>'watts')::float, (metrics->>'watt')::float)) AS watts_avg,
    max(coalesce((metrics->>'watts')::float, (metrics->>'watt')::float)) AS watts_max,
    min(coalesce((metrics->>'watts')::float, (metrics->>'watt')::float)) AS watts_min,
    avg((metrics->>'outside_temp')::float) AS temp_avg,
    sum((metrics->>'precipitation_mm')::float) AS rain_sum,
    avg((metrics->>'pv_surplus_watt')::float) AS pv_surplus_avg,
    avg((metrics->>'pumping_allowed')::float) AS pumping_allowed_ratio,
    CASE WHEN component = 'pump_control'
      THEN sum(coalesce((metrics->>'minutes')::float, 0))
      ELSE NULL END,
    CASE WHEN component = 'pump_control'
      THEN count(*) FILTER (WHERE (metrics->>'action') = 'on' OR strategy_applied ILIKE '%on%')
      ELSE NULL END,
    CASE WHEN component = 'pump_control'
      THEN sum(coalesce((metrics->>'minutes')::float, 0)
            * coalesce((metrics->>'watts')::float, (metrics->>'watt')::float, 510)) / 60000.0
      ELSE NULL END
  FROM public.device_events
  WHERE occurred_at >= now() - interval '2 days'
    AND occurred_at < date_trunc('hour', now())
  GROUP BY device_id, bucket, component, status
  ON CONFLICT (device_id, bucket, component, status) DO UPDATE
    SET event_count = EXCLUDED.event_count,
        watts_avg = EXCLUDED.watts_avg,
        watts_max = EXCLUDED.watts_max,
        watts_min = EXCLUDED.watts_min,
        temp_avg = EXCLUDED.temp_avg,
        rain_sum = EXCLUDED.rain_sum,
        pv_surplus_avg = EXCLUDED.pv_surplus_avg,
        pumping_allowed_ratio = EXCLUDED.pumping_allowed_ratio,
        pump_minutes = EXCLUDED.pump_minutes,
        pump_cycles = EXCLUDED.pump_cycles,
        pump_kwh = EXCLUDED.pump_kwh;

  DELETE FROM public.device_events
   WHERE occurred_at < now() - interval '48 hours'
     AND status IN ('healthy', 'info');
  DELETE FROM public.device_events
   WHERE occurred_at < now() - interval '30 days';
  DELETE FROM public.device_events_hourly
   WHERE bucket < now() - interval '90 days';
END;
$function$;

CREATE OR REPLACE FUNCTION public.aggregate_device_events_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.device_events_daily AS d (
    device_id, day, pump_minutes, pump_cycles, pump_kwh,
    pv_covered_pct, rain_mm, avg_outside_temp,
    warnings, criticals, updated_at
  )
  SELECT
    device_id,
    (bucket AT TIME ZONE 'UTC')::date AS day,
    coalesce(sum(pump_minutes) FILTER (WHERE component = 'pump_control'), 0),
    coalesce(sum(pump_cycles) FILTER (WHERE component = 'pump_control'), 0)::int,
    coalesce(sum(pump_kwh) FILTER (WHERE component = 'pump_control'), 0),
    CASE
      WHEN sum(pump_minutes) FILTER (WHERE component = 'pump_control') > 0
      THEN round(100.0 * (count(*) FILTER (WHERE pv_surplus_avg > 0 AND component = 'pump_control' AND pump_minutes > 0))::numeric
                 / NULLIF(count(*) FILTER (WHERE component = 'pump_control' AND pump_minutes > 0), 0), 1)
      ELSE NULL
    END,
    sum(rain_sum) FILTER (WHERE component = 'weather_dwd'),
    avg(temp_avg) FILTER (WHERE component = 'weather_dwd'),
    coalesce(sum(event_count) FILTER (WHERE status = 'warning'), 0)::int,
    coalesce(sum(event_count) FILTER (WHERE status = 'critical'), 0)::int,
    now()
  FROM public.device_events_hourly
  WHERE bucket >= (now() - interval '3 days')
  GROUP BY device_id, (bucket AT TIME ZONE 'UTC')::date
  ON CONFLICT (device_id, day) DO UPDATE
    SET pump_minutes = EXCLUDED.pump_minutes,
        pump_cycles = EXCLUDED.pump_cycles,
        pump_kwh = EXCLUDED.pump_kwh,
        pv_covered_pct = EXCLUDED.pv_covered_pct,
        rain_mm = EXCLUDED.rain_mm,
        avg_outside_temp = EXCLUDED.avg_outside_temp,
        warnings = EXCLUDED.warnings,
        criticals = EXCLUDED.criticals,
        updated_at = now();
END;
$function$;

DO $$ BEGIN PERFORM cron.unschedule('aggregate-device-events-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('aggregate-device-events-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('recompute-anomaly-baselines-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule('aggregate-device-events-15min', '*/15 * * * *',
  $$ SELECT public.aggregate_device_events(); $$);
SELECT cron.schedule('aggregate-device-events-daily', '10 * * * *',
  $$ SELECT public.aggregate_device_events_daily(); $$);
SELECT cron.schedule('recompute-anomaly-baselines-hourly', '30 * * * *',
  $$ SELECT public.recompute_anomaly_baselines(); $$);

SELECT public.aggregate_device_events();
SELECT public.aggregate_device_events_daily();
