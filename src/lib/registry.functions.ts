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

export const setDebugVerboseFn = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        channel: z.enum(["node-red", "alexa", "telegram", "chat", "rules", "local"]),
        on: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { setDebugVerbose } = await import("@/lib/registry.server");
    return { settings: setDebugVerbose(data.channel, data.on) };
  });

/** Debug tab: answer a sentence exactly as Alexa or Telegram would. */
export const simulateVoiceFn = createServerFn({ method: "POST" })
  .middleware([requirePiAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        channel: z.enum(["alexa", "telegram", "chat"]),
        text: z.string().min(1).max(400),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { routeText } = await import("@/lib/voice-intents.server");
    const ctx = { source: data.channel, allowControl: true } as const;
    const hit = await routeText(ctx, data.text);
    if (hit) return { ok: hit.ok, speech: hit.speech, via: "intent" as const };
    try {
      const { brainReply } = await import("@/lib/assistant-brain.server");
      const answer = await brainReply(
        { userId: "owner", source: data.channel, allowControl: true },
        data.text,
        { channel: data.channel },
      );
      return { ok: true, speech: answer, via: "ai" as const };
    } catch (e: unknown) {
      return {
        ok: false,
        speech: `Kein Treffer und der Assistent antwortet nicht: ${String((e as Error)?.message ?? e).slice(0, 160)}`,
        via: "none" as const,
      };
    }
  });

export const getDebugFn = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { debugEntries, registryInfo, debugSettings } = await import("@/lib/registry.server");
    const { localStorageInfo, recentRows } = await import("@/lib/local-timeseries.server");
    return {
      entries: debugEntries(200),
      registry: registryInfo(),
      verbose: debugSettings(),
      storage: localStorageInfo(),
      lastEvents: recentRows("event", 20) as unknown as Array<Record<string, string | number | boolean | null>>,
    };
  });
