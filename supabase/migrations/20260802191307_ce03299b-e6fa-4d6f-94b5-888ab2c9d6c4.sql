ALTER TABLE public.device_state_latest
  ADD COLUMN IF NOT EXISTS cpu_pct double precision,
  ADD COLUMN IF NOT EXISTS mem_pct double precision,
  ADD COLUMN IF NOT EXISTS disk_pct double precision,
  ADD COLUMN IF NOT EXISTS swap_pct double precision,
  ADD COLUMN IF NOT EXISTS temp_c double precision,
  ADD COLUMN IF NOT EXISTS uptime_s double precision,
  ADD COLUMN IF NOT EXISTS mqtt_broker_up boolean,
  ADD COLUMN IF NOT EXISTS sys_updated_at timestamptz;

-- One-roundtrip batch ingest: dedup + insert + state mirror + pump sessions.
CREATE OR REPLACE FUNCTION public.ingest_device_events(_device_id uuid, _events jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  e jsonb;
  m jsonb;
  last_row public.device_events%ROWTYPE;
  w_new double precision;
  w_old double precision;
  can_dedup boolean;
  inserted int := 0;
  deduped int := 0;
  occurred timestamptz;
  comp text;
  label text;
  st text;
  patch_pump boolean;
BEGIN
  FOR e IN SELECT * FROM jsonb_array_elements(_events)
  LOOP
    m := COALESCE(e->'metrics', '{}'::jsonb);
    IF (m->>'watts') IS NULL AND COALESCE(m->>'watt', m->>'house_power') IS NOT NULL THEN
      m := m || jsonb_build_object('watts', COALESCE(m->>'watt', m->>'house_power')::double precision);
    END IF;

    comp := e->>'component';
    label := COALESCE(e->>'device', '');
    st := e->>'status';
    occurred := COALESCE((e->>'ts')::timestamptz, now());

    SELECT * INTO last_row
      FROM public.device_events
     WHERE device_id = _device_id
       AND component = comp
       AND device_label = label
     ORDER BY occurred_at DESC
     LIMIT 1;

    w_new := NULLIF(m->>'watts','')::double precision;
    w_old := NULLIF(last_row.metrics->>'watts','')::double precision;

    can_dedup := last_row.id IS NOT NULL
      AND last_row.status = st
      AND st NOT IN ('warning','critical')
      AND ((w_new IS NULL AND w_old IS NULL) OR (w_new IS NOT NULL AND w_old IS NOT NULL AND abs(w_new - w_old) <= 5))
      AND (now() - last_row.occurred_at) < interval '5 minutes';

    IF can_dedup THEN
      UPDATE public.device_events
         SET occurred_at = occurred,
             sample_count = COALESCE(last_row.sample_count, 1) + 1
       WHERE id = last_row.id;
      deduped := deduped + 1;
    ELSE
      INSERT INTO public.device_events
        (device_id, component, device_label, status, message, strategy_applied, metrics, occurred_at)
      VALUES
        (_device_id, comp, label, st, e->>'message', e->>'strategy_applied', m, occurred);
      inserted := inserted + 1;
    END IF;

    -- pump session write-back
    IF (m->>'pump_session') IS NOT NULL AND (m->>'started_at') IS NOT NULL AND (m->>'stopped_at') IS NOT NULL THEN
      INSERT INTO public.pump_sessions
        (device_id, started_at, stopped_at, duration_s, avg_watts, kwh, pv_covered_pct, trigger, reason)
      VALUES (
        _device_id,
        (m->>'started_at')::timestamptz,
        (m->>'stopped_at')::timestamptz,
        GREATEST(0, EXTRACT(epoch FROM ((m->>'stopped_at')::timestamptz - (m->>'started_at')::timestamptz))::int),
        NULLIF(m->>'avg_watts','')::double precision,
        NULLIF(m->>'kwh','')::double precision,
        NULLIF(m->>'pv_covered_pct','')::double precision,
        left(COALESCE(m->>'trigger','manual'), 32),
        left(NULLIF(m->>'reason',''), 500)
      );
    END IF;
  END LOOP;

  -- mirror latest state
  e := _events -> (jsonb_array_length(_events) - 1);
  m := COALESCE(e->'metrics', '{}'::jsonb);
  patch_pump := (m->>'pump_on') IS NOT NULL OR (m->>'state') IS NOT NULL;

  INSERT INTO public.device_state_latest AS d (
    device_id, updated_at, watts_current, pv_surplus_w, outside_temp_c,
    rain_next_24h_mm, strategy_applied, last_reason, pump_on, pump_started_at,
    last_alarm_status, last_alarm_message, last_alarm_at
  )
  VALUES (
    _device_id,
    COALESCE((e->>'ts')::timestamptz, now()),
    NULLIF(COALESCE(m->>'watts', m->>'watt', m->>'house_power'),'')::double precision,
    NULLIF(m->>'pv_surplus_watt','')::double precision,
    NULLIF(m->>'outside_temp','')::double precision,
    NULLIF(m->>'forecast_rain_mm','')::double precision,
    NULLIF(e->>'strategy_applied',''),
    left(NULLIF(m->>'reason',''), 500),
    CASE WHEN (m->>'pump_on') IS NOT NULL THEN (m->>'pump_on')::boolean
         WHEN (m->>'state') IS NOT NULL THEN (m->>'state')::int = 1 END,
    CASE WHEN (m->>'pump_on')::boolean IS TRUE THEN COALESCE((e->>'ts')::timestamptz, now()) END,
    CASE WHEN e->>'status' IN ('warning','critical') THEN e->>'status' END,
    CASE WHEN e->>'status' IN ('warning','critical') THEN e->>'message' END,
    CASE WHEN e->>'status' IN ('warning','critical') THEN COALESCE((e->>'ts')::timestamptz, now()) END
  )
  ON CONFLICT (device_id) DO UPDATE SET
    updated_at = EXCLUDED.updated_at,
    watts_current = COALESCE(EXCLUDED.watts_current, d.watts_current),
    pv_surplus_w = COALESCE(EXCLUDED.pv_surplus_w, d.pv_surplus_w),
    outside_temp_c = COALESCE(EXCLUDED.outside_temp_c, d.outside_temp_c),
    rain_next_24h_mm = COALESCE(EXCLUDED.rain_next_24h_mm, d.rain_next_24h_mm),
    strategy_applied = COALESCE(EXCLUDED.strategy_applied, d.strategy_applied),
    last_reason = COALESCE(EXCLUDED.last_reason, d.last_reason),
    pump_on = COALESCE(EXCLUDED.pump_on, d.pump_on),
    pump_started_at = COALESCE(EXCLUDED.pump_started_at, d.pump_started_at),
    last_alarm_status = COALESCE(EXCLUDED.last_alarm_status, d.last_alarm_status),
    last_alarm_message = COALESCE(EXCLUDED.last_alarm_message, d.last_alarm_message),
    last_alarm_at = COALESCE(EXCLUDED.last_alarm_at, d.last_alarm_at);

  RETURN jsonb_build_object('inserted', inserted, 'deduped', deduped);
END;
$$;

-- Cheap system telemetry mirror (no device_events rows).
CREATE OR REPLACE FUNCTION public.mirror_device_system(_device_id uuid, _sys jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.device_state_latest AS d (device_id, sys_updated_at, cpu_pct, mem_pct, disk_pct, swap_pct, temp_c, uptime_s, mqtt_broker_up)
  VALUES (
    _device_id, now(),
    NULLIF(_sys->>'cpu_pct','')::double precision,
    NULLIF(_sys->>'mem_pct','')::double precision,
    NULLIF(_sys->>'disk_pct','')::double precision,
    NULLIF(_sys->>'swap_pct','')::double precision,
    NULLIF(_sys->>'temp_c','')::double precision,
    NULLIF(_sys->>'uptime_s','')::double precision,
    CASE WHEN (_sys->>'mqtt_broker_up') IS NOT NULL THEN (_sys->>'mqtt_broker_up')::boolean END
  )
  ON CONFLICT (device_id) DO UPDATE SET
    sys_updated_at = now(),
    cpu_pct = COALESCE(EXCLUDED.cpu_pct, d.cpu_pct),
    mem_pct = COALESCE(EXCLUDED.mem_pct, d.mem_pct),
    disk_pct = COALESCE(EXCLUDED.disk_pct, d.disk_pct),
    swap_pct = COALESCE(EXCLUDED.swap_pct, d.swap_pct),
    temp_c = COALESCE(EXCLUDED.temp_c, d.temp_c),
    uptime_s = COALESCE(EXCLUDED.uptime_s, d.uptime_s),
    mqtt_broker_up = COALESCE(EXCLUDED.mqtt_broker_up, d.mqtt_broker_up);
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_device_events(uuid, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirror_device_system(uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_device_events(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mirror_device_system(uuid, jsonb) TO service_role;

SELECT cron.alter_job(4, active := true);