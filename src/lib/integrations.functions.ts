// Pi-local: everything Node-RED needs to talk to this Pi. Local-first —
// no cloud URLs, no device pairing: Node-RED announces its endpoints here and
// streams values into the local 48h store.

import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";

export interface IntegrationsInfo {
  isPi: boolean;
  local: {
    lanIp: string | null;
    port: number;
    baseUrl: string;
    announceUrl: string;
    liveUrl: string;
    traceUrl: string;
    ingestTokenPresent: boolean;
    ingestTokenPrefix: string | null;
  };
}

export const getIntegrationsInfo = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async (): Promise<IntegrationsInfo> => {
    const { hasProcStats } = await import("./pi-runtime.server");
    const { buildNodeRedConfig, lanIp } = await import("./nodered-config.server");
    const cfg = await buildNodeRedConfig();
    const token = process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN || null;

    return {
      isPi: hasProcStats(),
      local: {
        lanIp: lanIp(),
        port: Number(process.env.PORT || 3000),
        baseUrl: cfg.local.baseUrl,
        announceUrl: cfg.local.announceUrl,
        liveUrl: cfg.local.liveUrl,
        traceUrl: cfg.local.traceUrl,
        ingestTokenPresent: !!token,
        ingestTokenPrefix: token ? token.slice(0, 10) : null,
      },
    };
  });

/** Flow JSON with this Pi's URLs/token baked in — import & deploy, no env editing. */
export const getPersonalizedFlow = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { buildNodeRedConfig } = await import("./nodered-config.server");
    const cfg = await buildNodeRedConfig();
    try {
      const { renderPersonalizedFlow } = await import("./nodered-personalize.server");
      return {
        json: await renderPersonalizedFlow(cfg),
        localBaseUrl: cfg.local.baseUrl,
        error: null as string | null,
      };
    } catch (e) {
      return {
        json: null as string | null,
        localBaseUrl: cfg.local.baseUrl,
        error: e instanceof Error ? e.message : "render failed",
      };
    }
  });

/** Integration health from the local trace store: last contact + last error per route. */
export const getIntegrationHealth = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    try {
      const { readRange } = await import("./local-timeseries.server");
      const rows = (await readRange("trace", since)) as unknown as Array<Record<string, unknown>>;
      const byRoute = new Map<
        string,
        {
          route: string;
          at: string;
          status: number | null;
          ok: boolean;
          reason: string | null;
          count: number;
          successes: number;
          failures: number;
        }
      >();
      for (const r of rows) {
        const route = String(r["route"] ?? "unknown");
        const status = r["status"] == null ? null : Number(r["status"]);
        const ok =
          typeof r["ok"] === "boolean"
            ? Boolean(r["ok"])
            : status != null && status >= 200 && status < 300;
        const prev = byRoute.get(route);
        byRoute.set(route, {
          route,
          at: String(r["ts"] ?? r["at"] ?? ""),
          status,
          ok,
          reason: (r["reason"] as string | undefined) ?? null,
          count: (prev?.count ?? 0) + 1,
          successes: (prev?.successes ?? 0) + (ok ? 1 : 0),
          failures: (prev?.failures ?? 0) + (ok ? 0 : 1),
        });
      }
      return {
        routes: [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route)),
        error: null as string | null,
      };
    } catch (e) {
      return { routes: [], error: e instanceof Error ? e.message : "unavailable" };
    }
  });
