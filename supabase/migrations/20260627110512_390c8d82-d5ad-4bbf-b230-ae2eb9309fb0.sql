
-- 1) Extend device_events
ALTER TABLE public.device_events
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS strategy_applied text;

CREATE INDEX IF NOT EXISTS device_events_device_occurred_idx
  ON public.device_events (device_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS device_events_component_status_idx
  ON public.device_events (device_id, component, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS device_events_strategy_idx
  ON public.device_events (device_id, strategy_applied, occurred_at DESC)
  WHERE strategy_applied IS NOT NULL;

-- 2) Hourly aggregates
CREATE TABLE IF NOT EXISTS public.device_events_hourly (
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  bucket timestamptz NOT NULL,
  component text NOT NULL,
  status text NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  watts_avg double precision,
  watts_max double precision,
  watts_min double precision,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, bucket, component, status)
);
GRANT SELECT ON public.device_events_hourly TO authenticated;
GRANT ALL ON public.device_events_hourly TO service_role;
ALTER TABLE public.device_events_hourly ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads hourly"
  ON public.device_events_hourly FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = device_events_hourly.device_id AND d.user_id = auth.uid()
  ));

-- 3) Strategy profiles (one row per device)
CREATE TABLE IF NOT EXISTS public.strategy_profiles (
  device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  eco_paused boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.strategy_profiles TO authenticated;
GRANT ALL ON public.strategy_profiles TO service_role;
ALTER TABLE public.strategy_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner manages strategy"
  ON public.strategy_profiles FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER strategy_profiles_touch
  BEFORE UPDATE ON public.strategy_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4) Anomaly baselines
CREATE TABLE IF NOT EXISTS public.anomaly_baselines (
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  metric text NOT NULL,
  mean double precision NOT NULL,
  stddev double precision NOT NULL,
  sample_count integer NOT NULL,
  window_days integer NOT NULL DEFAULT 7,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, metric)
);
GRANT SELECT ON public.anomaly_baselines TO authenticated;
GRANT ALL ON public.anomaly_baselines TO service_role;
ALTER TABLE public.anomaly_baselines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner reads baselines"
  ON public.anomaly_baselines FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = anomaly_baselines.device_id AND d.user_id = auth.uid()
  ));

-- Also: extend device_events RLS so owners can read
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='device_events' AND policyname='owner reads device_events'
  ) THEN
    EXECUTE 'CREATE POLICY "owner reads device_events" ON public.device_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.devices d WHERE d.id = device_events.device_id AND d.user_id = auth.uid()))';
  END IF;
END $$;

GRANT SELECT ON public.device_events TO authenticated;
