
ALTER TABLE public.device_events_hourly
  ADD COLUMN IF NOT EXISTS rain_past_night_max double precision;

CREATE OR REPLACE FUNCTION public.aggregate_device_events(_since interval DEFAULT interval '2 days')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  WITH pc AS (
    SELECT
      device_id,
      date_trunc('hour', occurred_at) AS bucket,
      occurred_at,
      COALESCE((metrics->>'today_total_runtime_min')::float, 0) AS ttr,
      COALESCE((metrics->>'state')::int, 0) AS st,
      COALESCE((metrics->>'watts')::float, (metrics->>'watt')::float) AS watts,
      status,
      COALESCE(sample_count, 1) AS sc
    FROM public.device_events
    WHERE component = 'pump_control'
      AND occurred_at >= now() - _since
      AND occurred_at < date_trunc('hour', now())
  ),
  pc_lag AS (
    SELECT
      *,
      LAG(st) OVER (PARTITION BY device_id ORDER BY occurred_at) AS prev_st
    FROM pc
  ),
  pc_final AS (
    SELECT
      device_id, bucket, status,
      GREATEST(0, MAX(ttr) - MIN(ttr)) AS pump_minutes,
      SUM(CASE WHEN st = 1 AND (prev_st = 0 OR prev_st IS NULL) THEN 1 ELSE 0 END)::int AS pump_cycles,
      AVG(watts) AS watts_avg,
      MAX(watts) AS watts_max,
      MIN(watts) AS watts_min,
      SUM(sc) AS event_count
    FROM pc_lag
    GROUP BY device_id, bucket, status
  )
  INSERT INTO public.device_events_hourly (
    device_id, bucket, component, status, event_count,
    watts_avg, watts_max, watts_min,
    pump_minutes, pump_cycles, pump_kwh
  )
  SELECT
    device_id, bucket, 'pump_control', status, event_count,
    watts_avg, watts_max, watts_min,
    pump_minutes, pump_cycles,
    pump_minutes * 0.51 / 60.0
  FROM pc_final
  ON CONFLICT (device_id, bucket, component, status) DO UPDATE
    SET event_count = EXCLUDED.event_count,
        watts_avg = EXCLUDED.watts_avg,
        watts_max = EXCLUDED.watts_max,
        watts_min = EXCLUDED.watts_min,
        pump_minutes = EXCLUDED.pump_minutes,
        pump_cycles = EXCLUDED.pump_cycles,
        pump_kwh = EXCLUDED.pump_kwh;

  INSERT INTO public.device_events_hourly (
    device_id, bucket, component, status, event_count,
    temp_avg, rain_sum, rain_past_night_max, pv_surplus_avg, pumping_allowed_ratio
  )
  SELECT
    device_id,
    date_trunc('hour', occurred_at) AS bucket,
    'eco_intelligence',
    status,
    SUM(COALESCE(sample_count, 1)) AS event_count,
    AVG((metrics->>'outside_temp')::float),
    MAX((metrics->>'forecast_rain_mm')::float),
    MAX((metrics->>'past_night_rain_mm')::float),
    AVG((metrics->>'pv_surplus_watt')::float),
    AVG((metrics->>'pumping_allowed')::float)
  FROM public.device_events
  WHERE component = 'eco_intelligence'
    AND occurred_at >= now() - _since
    AND occurred_at < date_trunc('hour', now())
  GROUP BY device_id, date_trunc('hour', occurred_at), status
  ON CONFLICT (device_id, bucket, component, status) DO UPDATE
    SET event_count = EXCLUDED.event_count,
        temp_avg = EXCLUDED.temp_avg,
        rain_sum = EXCLUDED.rain_sum,
        rain_past_night_max = EXCLUDED.rain_past_night_max,
        pv_surplus_avg = EXCLUDED.pv_surplus_avg,
        pumping_allowed_ratio = EXCLUDED.pumping_allowed_ratio;

  DELETE FROM public.device_events
   WHERE occurred_at < now() - interval '48 hours'
     AND status IN ('healthy', 'info');
  DELETE FROM public.device_events
   WHERE occurred_at < now() - interval '30 days';
  DELETE FROM public.device_events_hourly
   WHERE bucket < now() - interval '90 days';
END;
$function$;

CREATE OR REPLACE FUNCTION public.aggregate_device_events_daily(_since interval DEFAULT interval '3 days')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  WITH pump_hours AS (
    SELECT
      device_id,
      (bucket AT TIME ZONE 'UTC')::date AS day,
      bucket,
      SUM(pump_minutes) AS pump_minutes,
      SUM(pump_cycles) AS pump_cycles,
      SUM(pump_kwh) AS pump_kwh
    FROM public.device_events_hourly
    WHERE component = 'pump_control'
      AND bucket >= (now() - _since)
    GROUP BY device_id, (bucket AT TIME ZONE 'UTC')::date, bucket
  ),
  eco_hours AS (
    SELECT
      device_id,
      (bucket AT TIME ZONE 'UTC')::date AS day,
      bucket,
      MAX(pv_surplus_avg) AS pv_surplus,
      MAX(temp_avg) AS temp_avg,
      MAX(rain_past_night_max) AS past_night_rain
    FROM public.device_events_hourly
    WHERE component = 'eco_intelligence'
      AND bucket >= (now() - _since)
    GROUP BY device_id, (bucket AT TIME ZONE 'UTC')::date, bucket
  ),
  joined AS (
    SELECT
      p.device_id, p.day, p.bucket, p.pump_minutes, p.pump_cycles, p.pump_kwh,
      e.pv_surplus
    FROM pump_hours p
    LEFT JOIN eco_hours e USING (device_id, day, bucket)
  ),
  daily_pump AS (
    SELECT
      device_id, day,
      SUM(pump_minutes) AS pump_minutes,
      SUM(pump_cycles)::int AS pump_cycles,
      SUM(pump_kwh) AS pump_kwh,
      CASE WHEN SUM(pump_minutes) > 0
        THEN ROUND(100.0 * SUM(CASE WHEN pv_surplus > 200 THEN pump_minutes ELSE 0 END)::numeric
                        / NULLIF(SUM(pump_minutes), 0), 1)
        ELSE NULL END AS pv_covered_pct
    FROM joined
    GROUP BY device_id, day
  ),
  daily_eco AS (
    SELECT
      device_id, day,
      MAX(past_night_rain) AS rain_mm,
      AVG(temp_avg) AS avg_outside_temp
    FROM eco_hours
    GROUP BY device_id, day
  ),
  daily_status AS (
    SELECT
      device_id,
      (bucket AT TIME ZONE 'UTC')::date AS day,
      COALESCE(SUM(event_count) FILTER (WHERE status = 'warning'), 0)::int AS warnings,
      COALESCE(SUM(event_count) FILTER (WHERE status = 'critical'), 0)::int AS criticals
    FROM public.device_events_hourly
    WHERE bucket >= (now() - _since)
    GROUP BY device_id, (bucket AT TIME ZONE 'UTC')::date
  ),
  all_days AS (
    SELECT device_id, day FROM daily_pump
    UNION SELECT device_id, day FROM daily_eco
    UNION SELECT device_id, day FROM daily_status
  )
  INSERT INTO public.device_events_daily AS d (
    device_id, day, pump_minutes, pump_cycles, pump_kwh,
    pv_covered_pct, rain_mm, avg_outside_temp,
    warnings, criticals, updated_at
  )
  SELECT
    a.device_id, a.day,
    COALESCE(dp.pump_minutes, 0),
    COALESCE(dp.pump_cycles, 0),
    COALESCE(dp.pump_kwh, 0),
    dp.pv_covered_pct,
    de.rain_mm,
    de.avg_outside_temp,
    COALESCE(ds.warnings, 0),
    COALESCE(ds.criticals, 0),
    now()
  FROM all_days a
  LEFT JOIN daily_pump dp USING (device_id, day)
  LEFT JOIN daily_eco de USING (device_id, day)
  LEFT JOIN daily_status ds USING (device_id, day)
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

SELECT public.aggregate_device_events(interval '30 days');
SELECT public.aggregate_device_events_daily(interval '30 days');
