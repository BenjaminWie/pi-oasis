
REVOKE EXECUTE ON FUNCTION public.aggregate_device_events() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_anomaly_baselines() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aggregate_device_events() TO service_role;
GRANT EXECUTE ON FUNCTION public.recompute_anomaly_baselines() TO service_role;
