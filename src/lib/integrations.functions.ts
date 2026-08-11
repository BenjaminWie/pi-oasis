// Pi-local: surface everything Node-RED / external integrations need
// (Cloud-Bridge URLs, device token status, LAN ingest URL, flow template).
// All values are pulled from the live Pi state — nothing is hardcoded so the
// UI matches what Node-RED actually has to send.

import { createServerFn } from "@tanstack/react-start";
import { requirePiAuth } from "./pi-auth-middleware";

export interface IntegrationsInfo {
  isPi: boolean;
  cloudUrl: string;
  cloudBridge: {
    eventUrl: string;
    strategyUrl: string;
    liveUrl: string;
    realtimeBootstrapUrl: string;
    commandPollUrl: string;
    commandResultUrl: string;
    deviceTokenPresent: boolean;
    deviceTokenPrefix: string | null;
    deviceName: string | null;
    pairedAt: string | null;
  };
  local: {
    lanIp: string | null;
    port: number;
    ingestUrl: string | null;
    ingestTokenPresent: boolean;
    ingestTokenPrefix: string | null;
  };
  examples: {
    nodeRedTemplateUrl: string;
    docsUrl: string;
  };
}

function pickLanIp(): string | null {
  try {
    // dynamic require so this can run inside the handler only
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const os = require("node:os") as typeof import("node:os");
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] ?? []) {
        if (ni.family === "IPv4" && !ni.internal) {
          // prefer 192.168.* / 10.* / 172.16-31.*
          if (
            ni.address.startsWith("192.168.") ||
            ni.address.startsWith("10.") ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(ni.address)
          ) {
            return ni.address;
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export const getIntegrationsInfo = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async (): Promise<IntegrationsInfo> => {
    const { hasProcStats } = await import("./pi-runtime.server");
    const isPi = hasProcStats();
    const cloudUrl =
      process.env.VITE_PI_HUB_CLOUD_URL || "https://pi-hub.benniwie.com";

    let deviceTokenPresent = false;
    let deviceTokenPrefix: string | null = null;
    let deviceName: string | null = null;
    let pairedAt: string | null = null;
    if (isPi) {
      const { getCloudConfig } = await import("./pin-store.server");
      const cfg = await getCloudConfig();
      if (cfg) {
        deviceTokenPresent = !!cfg.deviceToken;
        deviceTokenPrefix = cfg.deviceToken ? cfg.deviceToken.slice(0, 10) : null;
        deviceName = cfg.name;
        pairedAt = cfg.installedAt;
      }
    }

    const port = Number(process.env.PORT || 3000);
    const lanIp = isPi ? pickLanIp() : null;

    return {
      isPi,
      cloudUrl,
      cloudBridge: {
        eventUrl: `${cloudUrl}/api/public/cloud-bridge/event`,
        strategyUrl: `${cloudUrl}/api/public/cloud-bridge/strategy`,
        liveUrl: `${cloudUrl}/api/public/live/publish`,
        realtimeBootstrapUrl: `${cloudUrl}/api/public/agent/realtime`,
        commandPollUrl: `${cloudUrl}/api/public/agent/poll?runner=nodered`,
        commandResultUrl: `${cloudUrl}/api/public/agent/result`,
        deviceTokenPresent,
        deviceTokenPrefix,
        deviceName,
        pairedAt,
      },
      local: {
        lanIp,
        port,
        ingestUrl: lanIp ? `http://${lanIp}:${port}/api/public/ingest/event` : null,
        ingestTokenPresent: !!(process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN),
        ingestTokenPrefix: (process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN)?.slice(0, 10) ?? null,
      },
      examples: {
        nodeRedTemplateUrl: `${cloudUrl}/nodered-template.json`,
        docsUrl: `${cloudUrl}/docs/nodered`,
      },
    };
  });

export const getCloudDeviceToken = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) return { token: null as string | null, error: "not on Pi" };
    const { getCloudConfig } = await import("./pin-store.server");
    const cfg = await getCloudConfig();
    if (!cfg?.deviceToken) return { token: null as string | null, error: "not paired" };
    return { token: cfg.deviceToken, error: null as string | null };
  });

export const getIntegrationSecrets = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { hasProcStats } = await import("./pi-runtime.server");
    if (!hasProcStats()) {
      return {
        cloudDeviceToken: null as string | null,
        localIngestToken: null as string | null,
        error: "not on Pi",
      };
    }

    const { getCloudConfig } = await import("./pin-store.server");
    const cfg = await getCloudConfig();
    return {
      cloudDeviceToken: cfg?.deviceToken ?? null,
      localIngestToken: process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN || null,
      error: cfg?.deviceToken ? null : "not paired",
    };
  });

/** Flow JSON with this Pi's tokens/URLs baked in — import & deploy, no env editing. */
export const getPersonalizedFlow = createServerFn({ method: "GET" })
  .middleware([requirePiAuth])
  .handler(async () => {
    const { buildNodeRedConfig } = await import("./nodered-config.server");
    const cfg = await buildNodeRedConfig();
    try {
      const { renderPersonalizedFlow } = await import("./nodered-personalize.server");
      const json = await renderPersonalizedFlow(cfg);
      return {
        json,
        paired: cfg.device.paired,
        wsReady: !!cfg.cloud.wsUrl,
        localBaseUrl: cfg.local.baseUrl,
        error: null as string | null,
      };
    } catch (e) {
      return {
        json: null as string | null,
        paired: cfg.device.paired,
        wsReady: !!cfg.cloud.wsUrl,
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
        { route: string; at: string; status: number | null; ok: boolean; reason: string | null; count: number }
      >();
      for (const r of rows) {
        const route = String(r["route"] ?? "unknown");
        const status = r["status"] == null ? null : Number(r["status"]);
        const ok = status != null && status >= 200 && status < 300;
        const prev = byRoute.get(route);
        byRoute.set(route, {
          route,
          at: String(r["ts"] ?? r["at"] ?? ""),
          status,
          ok,
          reason: (r["reason"] as string | undefined) ?? null,
          count: (prev?.count ?? 0) + 1,
        });
      }
      return { routes: [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route)), error: null as string | null };
    } catch (e) {
      return { routes: [], error: e instanceof Error ? e.message : "unavailable" };
    }
  });
