
-- 1) alerts table
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  count INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, kind, acknowledged_at)
);

CREATE INDEX alerts_device_open_idx
  ON public.alerts (device_id, kind)
  WHERE acknowledged_at IS NULL;

GRANT SELECT, UPDATE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view alerts on own devices" ON public.alerts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = alerts.device_id AND d.user_id = auth.uid()
  ));

CREATE POLICY "Users ack alerts on own devices" ON public.alerts
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = alerts.device_id AND d.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.devices d
    WHERE d.id = alerts.device_id AND d.user_id = auth.uid()
  ));

-- 2) alexa oauth token exchange log
CREATE TABLE public.alexa_oauth_token_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  client_id TEXT,
  grant_type TEXT,
  ok BOOLEAN NOT NULL DEFAULT false,
  error_code TEXT,
  note TEXT,
  remote_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX alexa_oauth_token_log_client_ts
  ON public.alexa_oauth_token_log (client_id, created_at DESC);

GRANT SELECT ON public.alexa_oauth_token_log TO authenticated;
GRANT ALL ON public.alexa_oauth_token_log TO service_role;
ALTER TABLE public.alexa_oauth_token_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view token log for own clients" ON public.alexa_oauth_token_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.alexa_oauth_clients c
    WHERE c.client_id = alexa_oauth_token_log.client_id
      AND c.user_id = auth.uid()
  ));

-- 3) anomaly detection function
CREATE OR REPLACE FUNCTION public.detect_pump_anomalies(
  _device_id UUID,
  _window_minutes INT DEFAULT 60
)
RETURNS TABLE (
  kind TEXT,
  severity TEXT,
  count INT,
  payload JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- short_cycle: ≥3 sessions with duration_s < 60 within the window
  RETURN QUERY
  SELECT
    'short_cycle'::TEXT,
    'warning'::TEXT,
    COUNT(*)::INT,
    jsonb_build_object(
      'sessions', COUNT(*),
      'window_minutes', _window_minutes,
      'avg_duration_s', ROUND(AVG(duration_s)::numeric, 1)
    )
  FROM public.pump_sessions
  WHERE device_id = _device_id
    AND started_at >= now() - make_interval(mins => _window_minutes)
    AND duration_s IS NOT NULL
    AND duration_s < 60
  HAVING COUNT(*) >= 3;

  -- stuck_on: any session started >15 min ago that never stopped
  RETURN QUERY
  SELECT
    'stuck_on'::TEXT,
    'critical'::TEXT,
    COUNT(*)::INT,
    jsonb_build_object(
      'oldest_started_at', MIN(started_at),
      'sessions_open', COUNT(*)
    )
  FROM public.pump_sessions
  WHERE device_id = _device_id
    AND stopped_at IS NULL
    AND started_at < now() - interval '15 minutes'
  HAVING COUNT(*) > 0;

  -- fault_event: device_events with status in ('error','critical') in last 24h
  RETURN QUERY
  SELECT
    'fault_event'::TEXT,
    CASE WHEN COUNT(*) FILTER (WHERE status = 'critical') > 0
         THEN 'critical'::TEXT ELSE 'warning'::TEXT END,
    COUNT(*)::INT,
    jsonb_build_object(
      'errors', COUNT(*) FILTER (WHERE status = 'error'),
      'criticals', COUNT(*) FILTER (WHERE status = 'critical'),
      'last_message', (
        SELECT message FROM public.device_events
        WHERE device_id = _device_id
          AND status IN ('error','critical')
          AND occurred_at >= now() - interval '24 hours'
        ORDER BY occurred_at DESC LIMIT 1
      )
    )
  FROM public.device_events
  WHERE device_id = _device_id
    AND status IN ('error','critical')
    AND occurred_at >= now() - interval '24 hours'
  HAVING COUNT(*) > 0;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.detect_pump_anomalies(UUID, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_pump_anomalies(UUID, INT) TO authenticated, service_role;

-- 4) upsert helper for alerts (idempotent per open kind)
CREATE OR REPLACE FUNCTION public.upsert_alert(
  _device_id UUID,
  _kind TEXT,
  _severity TEXT,
  _count INT,
  _payload JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_id UUID;
BEGIN
  SELECT id INTO existing_id
  FROM public.alerts
  WHERE device_id = _device_id
    AND kind = _kind
    AND acknowledged_at IS NULL
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    UPDATE public.alerts
       SET last_seen = now(),
           count = _count,
           severity = _severity,
           payload = _payload
     WHERE id = existing_id;
  ELSE
    INSERT INTO public.alerts (device_id, kind, severity, count, payload)
    VALUES (_device_id, _kind, _severity, _count, _payload);
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_alert(UUID, TEXT, TEXT, INT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_alert(UUID, TEXT, TEXT, INT, JSONB) TO service_role;
