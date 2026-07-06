
REVOKE EXECUTE ON FUNCTION public.aggregate_device_events() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aggregate_device_events_daily() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_anomaly_baselines() FROM PUBLIC, anon, authenticated;
