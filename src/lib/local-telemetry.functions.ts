// Read-only access to the Pi-local 48h telemetry store for the dashboard.
import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";

function sinceIso(hours: number) {
  return new Date(Date.now() - Math.max(1, Math.min(48, hours)) * 3600_000).toISOString();
}

export const getLocalPumpState = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { readRange, lastSeenByComponent } = await import("./local-timeseries.server");
    const since = sinceIso(6);
    const [ticks, events, components] = await Promise.all([
      readRange("tick", since, 200),
      readRange("event", since, 200),
      lastSeenByComponent(sinceIso(48)),
    ]);
    const lastTick = (ticks.length ? ticks[ticks.length - 1] : null) as any;
    const pumpEvents = events
      .filter((e: any) =>
        ["pump_control", "pump_guard", "eco_intelligence"].includes(String(e.component)),
      )
      .slice(-50)
      .reverse() as any[];
    return { lastTick, pumpEvents, components };
  });

export const getLocalBuckets = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .inputValidator((d: { hours?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { hourlyBuckets } = await import("./local-timeseries.server");
    return { buckets: await hourlyBuckets(sinceIso(data.hours ?? 48)) };
  });

export const getLocalTraces = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .inputValidator((d: { onlyErrors?: boolean; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { readRange } = await import("./local-timeseries.server");
    const rows = await readRange("trace", sinceIso(48), 2000);
    const filtered = data.onlyErrors ? rows.filter((r: any) => r.ok === false) : rows;
    const limit = Math.max(1, Math.min(200, data.limit ?? 60));
    return { traces: filtered.slice(-limit).reverse() as any[] };
  });
