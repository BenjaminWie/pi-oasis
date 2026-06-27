// pg_cron hook: nightly aggregation of device_events into device_events_hourly,
// then prune 'healthy' events older than 7 days. Auth: Supabase anon apikey header.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/aggregate-events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        if (!apikey || apikey !== process.env.SUPABASE_PUBLISHABLE_KEY) {
          return new Response("unauthorized", { status: 401 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Aggregate yesterday's events into hourly buckets
        const sql = `
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
        `;
        // Use rpc fallback via direct sql; admin client can't run raw SQL — use SECURITY DEFINER fn instead.
        // For simplicity here, call two separate operations via PostgREST is not possible. We rely on a DB function.
        const { error } = await supabaseAdmin.rpc("aggregate_device_events" as any);
        if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
