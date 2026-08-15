// Pi-side history endpoint: serves the local 48h JSONL store (ticks + events)
// so the cloud relay can answer analytics questions without any database.
import { createFileRoute } from "@tanstack/react-router";
import { guardLocalIngest } from "@/lib/local-ingest-guard.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

export const Route = createFileRoute("/api/public/pi/history")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const denied = guardLocalIngest(request);
        if (denied) return Response.json({ error: denied }, { status: 401, headers: CORS });

        const url = new URL(request.url);
        const kind = url.searchParams.get("kind") === "event" ? "event" : "tick";
        const minutes = Math.max(1, Math.min(2880, Number(url.searchParams.get("minutes") ?? 60)));
        const limit = Math.max(1, Math.min(5000, Number(url.searchParams.get("limit") ?? 2000)));
        const component = url.searchParams.get("component");

        const { readRange } = await import("@/lib/local-timeseries.server");
        const since = new Date(Date.now() - minutes * 60_000).toISOString();
        let rows = await readRange(kind as any, since, limit);
        if (component) rows = rows.filter((r: any) => r.component === component);

        return Response.json(
          { kind, since, count: rows.length, rows },
          { headers: { ...CORS, "cache-control": "no-store" } },
        );
      },
    },
  },
});
