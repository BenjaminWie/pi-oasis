// Pi-local server fn: returns the in-memory ingest ring buffer + counters.
// Guarded by the PI dashboard auth middleware — never reachable from outside.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePiAuth } from "./pi-auth-middleware";

export const getIngestEvents = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .inputValidator((input: { sinceId?: number }) =>
    z.object({ sinceId: z.number().int().nonnegative().optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { getRecentEvents } = await import("./ingest-buffer.server");
    return getRecentEvents(data.sinceId ?? 0);
  });

export const getIngestStatus = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { getRecentEvents } = await import("./ingest-buffer.server");
    const { getCloudConfig } = await import("./pin-store.server");
    const cfg = await getCloudConfig();
    const { stats } = getRecentEvents(Number.MAX_SAFE_INTEGER);
    const tokenConfigured = !!process.env.PI_INGEST_TOKEN;
    return {
      tokenConfigured,
      cloudPaired: !!cfg,
      stats,
    };
  });
