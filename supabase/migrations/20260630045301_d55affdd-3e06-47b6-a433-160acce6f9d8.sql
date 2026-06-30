ALTER TABLE public.device_events_hourly
  ADD COLUMN IF NOT EXISTS temp_avg numeric,
  ADD COLUMN IF NOT EXISTS rain_sum numeric,
  ADD COLUMN IF NOT EXISTS pv_surplus_avg numeric,
  ADD COLUMN IF NOT EXISTS pumping_allowed_ratio numeric;

CREATE OR REPLACE FUNCTION public.aggregate_device_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.device_events_hourly (
    device_id, bucket, component, status, event_count,
    watts_avg, watts_max, watts_min,
    temp_avg, rain_sum, pv_surplus_avg, pumping_allowed_ratio
  )
  SELECT
    device_id,
    date_trunc('hour', occurred_at) AS bucket,
    component,
    status,
    count(*) AS event_count,
    avg(coalesce((metrics->>'watts')::float, (metrics->>'watt')::float)) AS watts_avg,
    max(coalesce((metrics->>'watts')::float, (metrics->>'watt')::float)) AS watts_max,
    min(coalesce((metrics->>'watts')::float, (metrics->>'watt')::float)) AS watts_min,
    avg((metrics->>'outside_temp')::float) AS temp_avg,
    sum((metrics->>'precipitation_mm')::float) AS rain_sum,
    avg((metrics->>'pv_surplus_watt')::float) AS pv_surplus_avg,
    avg((metrics->>'pumping_allowed')::float) AS pumping_allowed_ratio
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
        pumping_allowed_ratio = EXCLUDED.pumping_allowed_ratio;

  DELETE FROM public.device_events
  WHERE occurred_at < now() - interval '7 days'
    AND status = 'healthy';
END;
$$;