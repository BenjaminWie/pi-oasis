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
    const cloudUrl = process.env.VITE_PI_HUB_CLOUD_URL || "https://pi-hub.benniwie.com";

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
        ingestTokenPrefix:
          (process.env.PI_INGEST_TOKEN || process.env.PI_LOCAL_INGEST_TOKEN)?.slice(0, 10) ?? null,
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
