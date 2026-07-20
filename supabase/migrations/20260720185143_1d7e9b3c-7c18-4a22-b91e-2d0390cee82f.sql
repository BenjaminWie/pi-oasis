
-- 1) device_state_latest: single row per device, source of truth for the dashboard "current" panel
CREATE TABLE IF NOT EXISTS public.device_state_latest (
  device_id UUID PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  pump_on BOOLEAN NOT NULL DEFAULT false,
  pump_started_at TIMESTAMPTZ,
  watts_current DOUBLE PRECISION,
  pv_surplus_w DOUBLE PRECISION,
  outside_temp_c DOUBLE PRECISION,
  rain_next_24h_mm DOUBLE PRECISION,
  strategy_applied TEXT,
  last_reason TEXT,
  last_alarm_status TEXT,
  last_alarm_message TEXT,
  last_alarm_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.device_state_latest TO authenticated;
GRANT ALL ON public.device_state_latest TO service_role;
ALTER TABLE public.device_state_latest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own state" ON public.device_state_latest;
CREATE POLICY "owners read own state"
  ON public.device_state_latest FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = device_state_latest.device_id AND d.user_id = auth.uid()
  ));

-- 2) pump_sessions: one row per completed pump run
CREATE TABLE IF NOT EXISTS public.pump_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  stopped_at TIMESTAMPTZ NOT NULL,
  duration_s INTEGER NOT NULL,
  avg_watts DOUBLE PRECISION,
  kwh DOUBLE PRECISION,
  pv_covered_pct NUMERIC(5,1),
  trigger TEXT NOT NULL DEFAULT 'manual', -- manual | schedule | eco | mcp | telegram | alexa
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pump_sessions_device_started_idx
  ON public.pump_sessions (device_id, started_at DESC);
GRANT SELECT ON public.pump_sessions TO authenticated;
GRANT ALL ON public.pump_sessions TO service_role;
ALTER TABLE public.pump_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own sessions" ON public.pump_sessions;
CREATE POLICY "owners read own sessions"
  ON public.pump_sessions FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = pump_sessions.device_id AND d.user_id = auth.uid()
  ));

-- 3) Realtime opt-in for the state table (broadcast fallback)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.device_state_latest;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END $$;

-- 4) Kill the frequent pg_cron jobs. Keep ONE nightly maintenance job.
DO $$ BEGIN PERFORM cron.unschedule('aggregate-device-events-15min'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('aggregate-device-events-daily'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('recompute-anomaly-baselines-hourly'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN PERFORM cron.unschedule('nightly-maintenance'); EXCEPTION WHEN OTHERS THEN NULL; END $$;

SELECT cron.schedule(
  'nightly-maintenance',
  '15 3 * * *',
  $$
    SELECT public.aggregate_device_events(interval '2 days');
    SELECT public.aggregate_device_events_daily(interval '3 days');
    SELECT public.recompute_anomaly_baselines();
    DELETE FROM public.device_events
     WHERE occurred_at < now() - interval '12 hours'
       AND status IN ('healthy','info');
    DELETE FROM public.device_events_hourly
     WHERE bucket < now() - interval '60 days';
  $$
);
