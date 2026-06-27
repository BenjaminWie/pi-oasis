
CREATE OR REPLACE FUNCTION public.aggregate_device_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.device_events_hourly (device_id, bucket, component, status, event_count, watts_avg, watts_max, watts_min)
  SELECT
    device_id,
    date_trunc('hour', occurred_at) AS bucket,
    component,
    status,
    count(*) AS event_count,
    avg((metrics->>'watts')::float) AS watts_avg,
    max((metrics->>'watts')::float) AS watts_max,
    min((metrics->>'watts')::float) AS watts_min
  FROM public.device_events
  WHERE occurred_at >= now() - interval '2 days'
    AND occurred_at < date_trunc('hour', now())
  GROUP BY device_id, bucket, component, status
  ON CONFLICT (device_id, bucket, component, status) DO UPDATE
    SET event_count = EXCLUDED.event_count,
        watts_avg = EXCLUDED.watts_avg,
        watts_max = EXCLUDED.watts_max,
        watts_min = EXCLUDED.watts_min;

  DELETE FROM public.device_events
  WHERE occurred_at < now() - interval '7 days'
    AND status = 'healthy';
END;
$$;

CREATE OR REPLACE FUNCTION public.recompute_anomaly_baselines()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.anomaly_baselines (device_id, metric, mean, stddev, sample_count, window_days, updated_at)
  SELECT
    device_id,
    'watts' AS metric,
    avg((metrics->>'watts')::float) AS mean,
    coalesce(stddev_samp((metrics->>'watts')::float), 0) AS stddev,
    count(*) AS sample_count,
    7,
    now()
  FROM public.device_events
  WHERE occurred_at >= now() - interval '7 days'
    AND metrics ? 'watts'
    AND status IN ('healthy','info')
  GROUP BY device_id
  HAVING count(*) >= 30
  ON CONFLICT (device_id, metric) DO UPDATE
    SET mean = EXCLUDED.mean,
        stddev = EXCLUDED.stddev,
        sample_count = EXCLUDED.sample_count,
        window_days = EXCLUDED.window_days,
        updated_at = EXCLUDED.updated_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.aggregate_device_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_anomaly_baselines() TO service_role;
