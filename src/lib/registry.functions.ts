// Server functions for the local Pi Control UI (Control / Tuning / Debug).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requirePiAuth } from "@/lib/pi-auth-middleware";

export const listEndpointsFn = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { listEndpoints, registryInfo } = await import("@/lib/registry.server");
    return { endpoints: listEndpoints(), registry: registryInfo() };
  });

export const invokeEndpointFn = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().min(1).max(64),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
        force: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { invokeEndpoint } = await import("@/lib/registry.server");
    return invokeEndpoint(data.id, data.value ?? true, {
      force: data.force,
      via: data.force ? "debug" : "ui",
    });
  });

export const saveEndpointConfigFn = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().min(1).max(64),
        label: z.string().max(80).optional(),
        unit: z.string().max(16).optional(),
        min: z.number().finite().nullable().optional(),
        max: z.number().finite().nullable().optional(),
        voice: z.boolean().optional(),
        control: z.boolean().optional(),
        hidden: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { setEndpointConfig } = await import("@/lib/registry.server");
    const { id, ...patch } = data;
    return setEndpointConfig(id, {
      ...patch,
      min: patch.min ?? undefined,
      max: patch.max ?? undefined,
    });
  });

export const getDebugFn = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { debugEntries, registryInfo } = await import("@/lib/registry.server");
    const { localStorageInfo, recentRows } = await import("@/lib/local-timeseries.server");
    return {
      entries: debugEntries(200),
      registry: registryInfo(),
      storage: localStorageInfo(),
      lastEvents: recentRows("event", 20) as unknown as Array<Record<string, string | number | boolean | null>>,
    };
  });
